begin;
set local lock_timeout='5s';
insert into public.workspace_aree(codice,nome,descrizione,icona,ordine) values('logistica','Logistica','Magazzino e preparazione delle spedizioni.','truck',45) on conflict(codice) do nothing;
update public.workspace_moduli set aree=array(select distinct x from unnest(aree||array['logistica'])x),aggiornato_il=now() where codice='magazzino';
insert into public.workspace_schermate(codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,aree,icona,metadati)
values('magazzino.allestisci_ordini','Allestisci Ordini','OCM consegnati al magazzino, scansione prodotti, FIFO e packing list.','workspace','/magazzino/allestisci-ordini','warehouse-order-preparation',false,true,66,'logistica',array['logistica'],'package',
 '{"required_permissions":["warehouse.fulfillment.read","warehouse.fulfillment.write","warehouse.fulfillment.configure"],"independent_access":true}')
on conflict(codice) do update set nome=excluded.nome,percorso=excluded.percorso,chiave_componente=excluded.chiave_componente,metadati=excluded.metadati,attiva=true,ultima_sincronizzazione=now();
insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values('magazzino','magazzino.allestisci_ordini',20,false,true) on conflict(modulo_codice,schermata_codice) do update set visibile_menu=true;
insert into public.permessi(codice,descrizione,modulo) values
 ('warehouse.fulfillment.read','Consulta allestimenti ordini e packing list','magazzino'),
 ('warehouse.fulfillment.write','Prepara, riscontra ed emetti DDT dagli OCM','magazzino'),
 ('warehouse.fulfillment.configure','Configura barcode, pezzi per cartone e serie DDT','magazzino')
on conflict(codice) do update set descrizione=excluded.descrizione,modulo=excluded.modulo;
create table public.warehouse_preparation_settings (
 id boolean primary key default true check(id), ddt_series integer check(ddt_series>0),
 default_warehouse integer not null default 5 check(default_warehouse>0),
 updated_at timestamptz not null default now()
);
insert into public.warehouse_preparation_settings(id) values(true);
create table public.warehouse_preparation_products (
 code text primary key check(code=upper(btrim(code)) and length(code) between 1 and 80),
 barcode text unique check(length(barcode) between 1 and 100),
 pieces_per_carton integer check(pieces_per_carton>0 and pieces_per_carton<=1000000),
 updated_at timestamptz not null default now()
);
create table public.warehouse_order_preparations (
 id uuid primary key default gen_random_uuid(), source_key text not null unique,
 source jsonb not null, source_raw jsonb not null, source_hash text not null,
 state jsonb not null default '{}', verification jsonb,
 status text not null default 'draft' check(status in('draft','verified','exporting','uncertain','completed','cancelled')),
 version integer not null default 1, export_token uuid, export_payload jsonb, ddt jsonb, error text,
 created_by uuid not null references public.utenti(id), updated_by uuid not null references public.utenti(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index warehouse_preparation_status on public.warehouse_order_preparations(status,updated_at desc);
create table public.warehouse_preparation_events (
 id bigint generated always as identity primary key, preparation_id uuid not null references public.warehouse_order_preparations(id),
 event_id uuid not null, event_type text not null, actor uuid not null references public.utenti(id), payload jsonb not null,
 created_at timestamptz not null default now(), unique(preparation_id,event_id)
);
create table public.warehouse_preparation_lot_holds (
 preparation_id uuid not null references public.warehouse_order_preparations(id),
 code text not null, warehouse integer not null, lot_id bigint not null, quantity numeric(20,6) not null check(quantity>0),
 primary key(preparation_id,code,warehouse,lot_id)
);
create index warehouse_preparation_lot_lookup on public.warehouse_preparation_lot_holds(code,warehouse,lot_id);
do $$declare t text;begin
 foreach t in array array['warehouse_preparation_settings','warehouse_preparation_products','warehouse_order_preparations','warehouse_preparation_events','warehouse_preparation_lot_holds'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end;$$;
grant usage,select on sequence public.warehouse_preparation_events_id_seq to service_role;
-- All mutations go through the authenticated API. CAS prevents lost updates across devices.
-- One short transaction serializes lot holds and export claims, never the remote Mexal call.
create function public.warehouse_preparation_mutate(p_id uuid,p_version integer,p_event uuid,p_actor uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.warehouse_order_preparations;h record;v_held numeric;
begin
 perform pg_advisory_xact_lock(hashtextextended('warehouse-order-preparation',0));
 if not exists(select 1 from public.utenti where id=p_actor and attivo is not false) then raise exception 'Utente non valido';end if;
 if p_action='create' then
  insert into public.warehouse_order_preparations(source_key,source,source_raw,source_hash,state,created_by,updated_by)
  values(p_data->>'source_key',p_data->'source',p_data->'source_raw',p_data->>'source_hash',p_data->'state',p_actor,p_actor)
  on conflict(source_key) do nothing;
  select * into strict r from public.warehouse_order_preparations where source_key=p_data->>'source_key';
  return to_jsonb(r);
 end if;
 select * into strict r from public.warehouse_order_preparations where id=p_id for update;
 if exists(select 1 from public.warehouse_preparation_events where preparation_id=p_id and event_id=p_event) then
  if p_action='claim_export' then raise exception 'Invio già acquisito: verifica esito senza ripetere il DDT' using errcode='40001';end if;
  return to_jsonb(r);
 end if;
 if r.version<>p_version then raise exception 'Preparazione aggiornata da un altro dispositivo: ricarica prima di continuare.' using errcode='40001';end if;
 if p_action in('save','verify','cancel','refresh') and r.status not in('draft','verified') then raise exception 'Preparazione non modificabile nello stato %',r.status;end if;
 if p_action='save' then
  r.state:=p_data->'state';r.status:='draft';r.verification:=null;
  delete from public.warehouse_preparation_lot_holds where preparation_id=p_id;
 elsif p_action='refresh' then
  r.source:=p_data->'source';r.source_raw:=p_data->'source_raw';r.source_hash:=p_data->>'source_hash';
  r.status:='draft';r.verification:=null;delete from public.warehouse_preparation_lot_holds where preparation_id=p_id;
 elsif p_action='verify' then
  if not coalesce((p_data->'verification'->>'ok')::boolean,false) then raise exception 'Riscontro non positivo';end if;
  for h in select x.code,x.warehouse,x.lot_id,sum(x.quantity) quantity,min(x.capacity) capacity from jsonb_to_recordset(p_data->'holds') as x(code text,warehouse integer,lot_id bigint,quantity numeric,capacity numeric) group by x.code,x.warehouse,x.lot_id loop
   if h.quantity<=0 or h.warehouse<=0 or h.lot_id<0 or h.capacity is null then raise exception 'Riserva lotto non valida';end if;
   select coalesce(sum(quantity),0) into v_held from public.warehouse_preparation_lot_holds where code=h.code and warehouse=h.warehouse and lot_id=h.lot_id and preparation_id<>p_id;
   if h.quantity+v_held>h.capacity then raise exception 'Lotto % riservato da un altro allestimento. Ripeti il riscontro.',h.code using errcode='40001';end if;
  end loop;
  delete from public.warehouse_preparation_lot_holds where preparation_id=p_id;
  insert into public.warehouse_preparation_lot_holds select p_id,x.code,x.warehouse,x.lot_id,sum(x.quantity) from jsonb_to_recordset(p_data->'holds') as x(code text,warehouse integer,lot_id bigint,quantity numeric) group by x.code,x.warehouse,x.lot_id;
  r.verification:=p_data->'verification';r.status:='verified';
 elsif p_action='claim_export' then
  if r.status<>'verified' or not coalesce((p_data->>'confirmedLots')::boolean,false) then raise exception 'Riscontro e conferma dei lotti richiesti';end if;
  if r.source_hash<>p_data->>'source_hash' then raise exception 'Ordine Mexal cambiato: ripeti il riscontro';end if;
  r.status:='exporting';r.export_token:=p_event;r.export_payload:=p_data->'payload';r.error:=null;
 elsif p_action='uncertain' then
  if r.status<>'exporting' or r.export_token<>(p_data->>'token')::uuid then raise exception 'Invio non corrispondente';end if;
  r.status:='uncertain';r.error:=left(p_data->>'error',1000);
 elsif p_action='finish' then
  if r.status not in('exporting','uncertain') or r.export_token<>(p_data->>'token')::uuid then raise exception 'Invio non corrispondente';end if;
  r.status:='completed';r.ddt:=p_data->'ddt';r.error:=null;
  delete from public.warehouse_preparation_lot_holds where preparation_id=p_id;
 elsif p_action='reopen' then
  if r.status<>'cancelled' then raise exception 'Solo una preparazione annullata può essere riaperta';end if;
  r.status:='draft';r.verification:=null;
 elsif p_action='cancel' then
  r.status:='cancelled';r.verification:=null;delete from public.warehouse_preparation_lot_holds where preparation_id=p_id;
 else raise exception 'Operazione non valida';end if;
 r.version:=r.version+1;r.updated_at:=now();r.updated_by:=p_actor;
 update public.warehouse_order_preparations set state=r.state,verification=r.verification,status=r.status,version=r.version,source=r.source,source_raw=r.source_raw,source_hash=r.source_hash,
 export_token=r.export_token,export_payload=r.export_payload,ddt=r.ddt,error=r.error,updated_at=r.updated_at,updated_by=r.updated_by where id=p_id;
 insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload) values(p_id,p_event,p_action,p_actor,p_data);
 return to_jsonb(r);
end;$$;
revoke all on function public.warehouse_preparation_mutate(uuid,integer,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.warehouse_preparation_mutate(uuid,integer,uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

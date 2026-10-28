begin;
alter table public.crm_external_connections add column amazon_refunds_from date;
alter table public.crm_external_connections add column amazon_refund_state jsonb not null default '{}';
update public.crm_external_connections set amazon_refunds_from=date '2026-10-22' where provider_code='amazon_sp_api';

create table public.crm_amazon_refunds(
 id uuid primary key default gen_random_uuid(),
 connection_id uuid not null references public.crm_external_connections(id) on delete restrict,
 event_key text not null unique check(event_key~'^[a-f0-9]{64}$'),
 amazon_order_id text not null check(amazon_order_id~'^\d{3}-\d{7}-\d{7}$'),
 posted_at timestamptz not null,marketplace text,currency text not null check(currency='EUR'),
 gross numeric check(gross>0),net numeric check(net>=0),tax numeric check(tax>=0),
 items jsonb not null check(jsonb_typeof(items)='array'),
 financial_hash text not null,financial_snapshot jsonb not null,source_status text,
 source_conflict boolean not null default false,parse_error text,
 export_status text not null default 'pending' check(export_status in('pending','processing','blocked','reconciliation_required','emitted')),
 cox_reference jsonb,error text,disposition_summary jsonb,
 token uuid,pending_payload jsonb,pending_fingerprint text,applied_payload jsonb,applied_fingerprint text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),
 check(gross is null or gross=net+tax)
);
create index crm_amazon_refunds_connection_idx on public.crm_amazon_refunds(connection_id,id);
create index crm_amazon_refunds_order_idx on public.crm_amazon_refunds(connection_id,amazon_order_id,posted_at,event_key);
alter table public.crm_amazon_refunds enable row level security;
revoke all on public.crm_amazon_refunds from public,anon,authenticated;
grant all on public.crm_amazon_refunds to service_role;
grant select(id,connection_id,event_key,amazon_order_id,posted_at,marketplace,currency,gross,net,tax,items,source_status,export_status,cox_reference,error,disposition_summary,updated_at) on public.crm_amazon_refunds to authenticated;
create policy "Amazon refunds scoped read" on public.crm_amazon_refunds for select to authenticated using(
 exists(select 1 from public.crm_external_connections c where c.id=connection_id and public.crm_row_visible(c.responsabile_id,c.reparto_id,public.crm_digital_module_for_connection(c.tipo)))
);

create table public.crm_amazon_physical_returns(
 connection_id uuid not null references public.crm_external_connections(id) on delete restrict,
 return_key text not null,amazon_order_id text not null,sku text not null,quantity integer not null check(quantity>0),
 returned_at timestamptz not null,disposition text not null,status text not null,updated_at timestamptz not null default now(),
 primary key(connection_id,return_key)
);
create index crm_amazon_physical_returns_order_idx on public.crm_amazon_physical_returns(connection_id,amazon_order_id);
alter table public.crm_amazon_physical_returns enable row level security;
revoke all on public.crm_amazon_physical_returns from public,anon,authenticated;
grant all on public.crm_amazon_physical_returns to service_role;

create function public.crm_store_amazon_refund_page_service(p_connection_id uuid,p_expected_state jsonb,p_kind text,p_rows jsonb,p_next_state jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare c public.crm_external_connections;r jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Servizio riservato' using errcode='42501';end if;
 select * into strict c from crm_external_connections where id=p_connection_id for update;
 if c.provider_code<>'amazon_sp_api' or not c.abilitata or c.amazon_refunds_from is null then raise exception 'Connessione rimborsi Amazon non configurata';end if;
 if c.amazon_refund_state is distinct from p_expected_state then raise exception 'Cursore rimborsi Amazon cambiato' using errcode='40001';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>10000 or p_kind not in('finance','physical') then raise exception 'Pagina rimborsi non valida';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if p_kind='finance' then
   if (r->>'posted_at')::timestamptz at time zone 'Europe/Rome' < c.amazon_refunds_from::timestamp then raise exception 'Rimborso precedente alla data iniziale';end if;
   insert into crm_amazon_refunds(connection_id,event_key,amazon_order_id,posted_at,marketplace,currency,gross,net,tax,items,financial_hash,financial_snapshot,source_status,parse_error,export_status,error)
   values(c.id,r->>'event_key',r->>'amazon_order_id',(r->>'posted_at')::timestamptz,r->>'marketplace',r->>'currency',(r->>'gross')::numeric,(r->>'net')::numeric,(r->>'tax')::numeric,r->'items',r->>'financial_hash',r->'financial_snapshot',r->>'source_status',r->>'parse_error',case when nullif(r->>'parse_error','') is null then 'pending' else 'blocked' end,r->>'parse_error')
   on conflict(event_key) do update set source_status=excluded.source_status,last_seen_at=now(),
    source_conflict=crm_amazon_refunds.source_conflict or crm_amazon_refunds.financial_hash<>excluded.financial_hash,
    error=case when crm_amazon_refunds.financial_hash<>excluded.financial_hash then 'Dati finanziari Amazon modificati per lo stesso rimborso: riconciliazione richiesta.' else crm_amazon_refunds.error end
   where crm_amazon_refunds.connection_id=c.id;
  else
   insert into crm_amazon_physical_returns(connection_id,return_key,amazon_order_id,sku,quantity,returned_at,disposition,status)
   values(c.id,r->>'return_key',r->>'amazon_order_id',r->>'sku',(r->>'quantity')::integer,(r->>'returned_at')::timestamptz,r->>'disposition',r->>'status')
   on conflict(connection_id,return_key) do update set quantity=excluded.quantity,disposition=excluded.disposition,status=excluded.status,updated_at=now();
  end if;
 end loop;
 update crm_external_connections set amazon_refund_state=p_next_state where id=c.id;
end $$;

create function public.crm_claim_amazon_refund_service(p_id uuid,p_payload jsonb,p_fingerprint text,p_disposition jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare r public.crm_amazon_refunds;claim uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Servizio riservato' using errcode='42501';end if;
 select * into strict r from crm_amazon_refunds where id=p_id for update;
 if r.export_status in('processing','reconciliation_required') or (r.export_status='emitted' and r.applied_fingerprint=p_fingerprint) then return null;end if;
 if r.source_conflict or r.parse_error is not null or r.gross is null or not exists(select 1 from crm_external_connections c where c.id=r.connection_id and c.abilitata and c.provider_code='amazon_sp_api' and (r.posted_at at time zone 'Europe/Rome')::date>=c.amazon_refunds_from) then raise exception 'Rimborso non emettibile';end if;
 if coalesce(p_payload->>'sigla','')<>'CO' or coalesce(p_payload->>'cod_modulo','')<>'X' or coalesce(p_payload->>'cod_conto','')<>'501.02156' or coalesce((p_payload->>'id_magazzino')::int,0)<>4 or coalesce(jsonb_typeof(p_payload->'quantita'),'')<>'array' or jsonb_array_length(p_payload->'quantita')=0 then raise exception 'Piano COX reso non valido';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'quantita') q where (q->>1)::numeric>=0) then raise exception 'Quantità reso negative richieste';end if;
 claim:=gen_random_uuid();
 update crm_amazon_refunds set export_status='processing',token=claim,pending_payload=p_payload,pending_fingerprint=p_fingerprint,disposition_summary=p_disposition,error=null,updated_at=now() where id=p_id;
 return claim;
end $$;

create function public.crm_finish_amazon_refund_service(p_id uuid,p_token uuid,p_status text,p_reference jsonb,p_error text) returns void
language plpgsql security definer set search_path=public as $$
declare r public.crm_amazon_refunds;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Servizio riservato' using errcode='42501';end if;
 select * into strict r from crm_amazon_refunds where id=p_id for update;
 if r.token is distinct from p_token or r.export_status not in('processing','reconciliation_required') or p_status not in('blocked','reconciliation_required','emitted') or (r.export_status='reconciliation_required' and p_status='blocked') then raise exception 'Claim reso non valido';end if;
 if p_status='emitted' and (p_reference is null or coalesce((p_reference->>'number')::int,0)<=0 or coalesce((p_reference->>'series')::int,0)<=0 or coalesce(p_reference->>'date','')<>r.pending_payload->>'data_documento' or coalesce(p_reference->>'year','')<>left(r.pending_payload->>'data_documento',4)) then raise exception 'Riferimento COX reso non valido';end if;
 update crm_amazon_refunds set export_status=p_status,cox_reference=coalesce(p_reference,cox_reference),error=left(p_error,500),
  applied_payload=case when p_status='emitted' then pending_payload else applied_payload end,
  applied_fingerprint=case when p_status='emitted' then pending_fingerprint else applied_fingerprint end,
  pending_payload=case when p_status in('emitted','blocked') then null else pending_payload end,
  pending_fingerprint=case when p_status in('emitted','blocked') then null else pending_fingerprint end,updated_at=now()
 where id=p_id;
end $$;
revoke all on function public.crm_store_amazon_refund_page_service(uuid,jsonb,text,jsonb,jsonb),public.crm_claim_amazon_refund_service(uuid,jsonb,text,jsonb),public.crm_finish_amazon_refund_service(uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.crm_store_amazon_refund_page_service(uuid,jsonb,text,jsonb,jsonb),public.crm_claim_amazon_refund_service(uuid,jsonb,text,jsonb),public.crm_finish_amazon_refund_service(uuid,uuid,text,jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;

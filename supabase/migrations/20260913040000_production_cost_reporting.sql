begin;
insert into public.workspace_schermate
 (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,aree,icona)
values
 ('produzione.configurazione_costi','CONFIGURAZIONE COSTI PRODUZIONE','Tariffe, turni, lavaggi e obiettivi economici versionati.','workspace','/settings/costi-produzione','ProductionCostConfiguration',false,true,410,'configurazioni',array['configurazioni'],'settings'),
 ('produzione.consuntivi','CONSUNTIVI PRODUZIONI','Tempi, personale, materiali e confronto economico delle produzioni.','workspace','/consuntivi-produzioni','ProductionCostReports',false,true,420,'produzione',array['produzione'],'chart-column')
on conflict(codice) do update set percorso=excluded.percorso,chiave_componente=excluded.chiave_componente;
insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values ('impostazioni','produzione.configurazione_costi',410,false,true),
 ('analisi_dati','produzione.consuntivi',420,false,true)
on conflict(modulo_codice,schermata_codice) do nothing;

create table public.production_cost_configurations(
 id uuid primary key default gen_random_uuid(),
 effective_from date not null,
 settings jsonb not null check(jsonb_typeof(settings)='object'),
 created_at timestamptz not null default now(),
 created_by uuid not null references public.utenti(id),
 note text not null default ''
);
create table public.production_cost_records(
 mes_order_id integer primary key,
 evidence jsonb not null,
 configuration_id uuid references public.production_cost_configurations(id),
 created_at timestamptz not null default now(),
 refreshed_at timestamptz not null default now()
);
create table public.production_cost_adjustments(
 id uuid primary key default gen_random_uuid(),
 mes_order_id integer not null references public.production_cost_records(mes_order_id),
 details jsonb not null check(jsonb_typeof(details)='object'),
 reason text not null check(length(btrim(reason))>0),
 created_at timestamptz not null default now(),
 created_by uuid not null references public.utenti(id)
);
create table public.production_cost_invoice_allocations(
 id uuid primary key default gen_random_uuid(),
 mes_order_id integer not null references public.production_cost_records(mes_order_id),
 invoice_line_id bigint not null references public.mexal_fatture_vendita_righe(id),
 quantity numeric not null check(quantity>0),
 created_at timestamptz not null default now(),
 created_by uuid not null references public.utenti(id),
 unique(mes_order_id,invoice_line_id)
);
-- Only authenticated server handlers can write these ledgers. Configuration and
-- corrections are append-only; imported MES evidence is not an editable actual.
alter table public.production_cost_configurations enable row level security;
alter table public.production_cost_records enable row level security;
alter table public.production_cost_adjustments enable row level security;
alter table public.production_cost_invoice_allocations enable row level security;
revoke all on public.production_cost_configurations,public.production_cost_records,
 public.production_cost_adjustments,public.production_cost_invoice_allocations from anon,authenticated;
grant all on public.production_cost_configurations,public.production_cost_records,
 public.production_cost_adjustments,public.production_cost_invoice_allocations to service_role;
create index production_cost_adjustments_order on public.production_cost_adjustments(mes_order_id,created_at desc);
create function public.production_cost_preserve_configuration() returns trigger
language plpgsql set search_path=public as $$
begin
 if old.configuration_id is not null then new.configuration_id:=old.configuration_id; end if;
 return new;
end $$;
create trigger production_cost_preserve_configuration before update on production_cost_records
for each row execute function production_cost_preserve_configuration();

create function public.production_cost_allocate_invoice(p_order integer,p_line bigint,p_quantity numeric,p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
declare available numeric; allocated numeric;
begin
 select abs(quantita) into available from mexal_fatture_vendita_righe where id=p_line for update;
 if available is null or p_quantity<=0 then raise exception 'Quantità fattura non valida'; end if;
 select coalesce(sum(quantity),0) into allocated from production_cost_invoice_allocations
 where invoice_line_id=p_line and mes_order_id<>p_order;
 if allocated+p_quantity>available then raise exception 'Quantità già attribuita ad altre produzioni'; end if;
 insert into production_cost_invoice_allocations(mes_order_id,invoice_line_id,quantity,created_by)
 values(p_order,p_line,p_quantity,p_user)
 on conflict(mes_order_id,invoice_line_id) do update set quantity=excluded.quantity,created_by=excluded.created_by,created_at=now();
 insert into production_cost_adjustments(mes_order_id,details,reason,created_by)
 values(p_order,jsonb_build_object('invoiceLineId',p_line,'allocatedQuantity',p_quantity),
  'Attribuzione esplicita riga fattura alla produzione',p_user);
end $$;
revoke all on function public.production_cost_allocate_invoice(integer,bigint,numeric,uuid) from public,anon,authenticated;
grant execute on function public.production_cost_allocate_invoice(integer,bigint,numeric,uuid) to service_role;
-- Import only confirmed MES identifiers already mirrored in Workspace.
-- Confirmation is NOT proof of the current production status or actual costs.
with source as (
 select distinct on ((o->>'id')::integer)
  (o->>'id')::integer mes_id,o,r.id request_id,r.created_at,c.created_at confirmed_at
 from workspace_v4_confirmation_mirrors c
 join workspace_v4_previews p on p.id=c.preview_id
 join workspace_production_requests r on r.id=p.production_request_id
 cross join lateral jsonb_array_elements(coalesce(c.mes_response->'productionOrders','[]'::jsonb)) o
 where c.mes_response->>'productionCreated'='true' and o->>'id' ~ '^[0-9]+$'
 order by (o->>'id')::integer,c.created_at desc
), prepared as (
 select s.*,i.details from source s
 cross join lateral (
  select jsonb_build_object(
   'articleName',max(l.descrizione),
   'unit',max(i.unita_misura_produzione),
   'customerCode',case when count(distinct h.codice_cliente)=1 then max(h.codice_cliente) else null end,
   'links',coalesce(jsonb_agg(distinct jsonb_build_object('lineId',i.ordine_riga_id,
    'oct',h.numero_ordine_visualizzato,'customerCode',h.codice_cliente,
    'quantity',i.quantita_unita_produzione,'unit',i.unita_misura_produzione))
    filter(where i.ordine_riga_id is not null),'[]'::jsonb)
  ) details
  from workspace_production_request_items i
  join ordini_testate h on h.id=i.ordine_id
  left join ordini_righe l on l.id=i.ordine_riga_id
  where i.production_request_id=s.request_id and
   upper(s.o->>'articleCode') in (upper(i.codice_articolo_commerciale),upper(i.codice_articolo_produttivo))
 ) i
)
insert into production_cost_records(mes_order_id,evidence,refreshed_at)
select mes_id,jsonb_build_object('id',mes_id,'orderNumber',o->>'number','articleCode',o->>'articleCode',
 'articleName',coalesce(details->>'articleName',o->>'articleCode'),'unit',details->>'unit',
 'customerCode',details->>'customerCode',
 'customerName',coalesce((select c.ragione_sociale from crm_classified_customers c where c.codice_cliente=details->>'customerCode' limit 1),details->>'customerCode','Cliente da riconciliare'),
 'quantity',o->'quantity','date',created_at,'dueAt',o->>'requiredAt','state','Stato attuale da aggiornare da MES',
 'lot','','bulkLot','','formulaVersion',null,'formulaRevision',null,'links',details->'links',
 'baseline',null,'bulkSl',null,'productSl',null,'bulkSlReference','','productSlReference','',
 'works','[]'::jsonb,'operations','[]'::jsonb,'historicalMaterials','[]'::jsonb,
 'workspaceSnapshot',true,'confirmedAt',confirmed_at),confirmed_at
from prepared on conflict(mes_order_id) do nothing;
notify pgrst,'reload schema';
commit;

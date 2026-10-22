begin;
alter table public.crm_external_orders add column fulfilled_at timestamptz;
alter table public.crm_external_connections add column amazon_shipment_state jsonb not null default '{}';
alter table public.crm_external_connections add column amazon_shipments_covered_at timestamptz;
create table public.crm_amazon_shipment_dates(
 connection_id uuid not null references public.crm_external_connections(id) on delete cascade,
 external_id text not null,shipped_at timestamptz not null,updated_at timestamptz not null default now(),primary key(connection_id,external_id)
);
alter table public.crm_amazon_shipment_dates enable row level security;
revoke all on public.crm_amazon_shipment_dates from public,anon,authenticated;
grant all on public.crm_amazon_shipment_dates to service_role;

create function public.crm_amazon_effective_date() returns trigger language plpgsql security definer set search_path=public as $$
declare shipped timestamptz;
begin
 if exists(select 1 from crm_external_connections where id=new.connection_id and provider_code='amazon_sp_api') then
  new.raw_summary:=coalesce(new.raw_summary,'{}')||jsonb_build_object('provider','amazon_sp_api','purchase_date',coalesce(new.raw_summary->>'purchase_date',new.ordered_at::text));
  if upper(new.stato)='SHIPPED' then
   select shipped_at into shipped from crm_amazon_shipment_dates where connection_id=new.connection_id and external_id=new.external_id;
   new.fulfilled_at:=greatest(shipped,nullif(new.raw_summary->>'fulfilled_at','')::timestamptz);
   if new.fulfilled_at is not null then
    new.ordered_at:=new.fulfilled_at;
    new.raw_summary:=new.raw_summary||jsonb_build_object('fulfilled_at',new.fulfilled_at,'date_basis','fulfillment');
   else new.raw_summary:=new.raw_summary||jsonb_build_object('date_basis','purchase_unverified'); end if;
  else new.fulfilled_at:=null; end if;
 end if;
 return new;
end $$;
create trigger crm_amazon_effective_date before insert or update of ordered_at,raw_summary,stato on public.crm_external_orders for each row execute function public.crm_amazon_effective_date();

create function public.crm_store_amazon_shipment_dates_service(p_connection_id uuid,p_rows jsonb,p_state jsonb,p_covered_at timestamptz) returns void
language plpgsql security definer set search_path=public as $$
declare r jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Servizio riservato' using errcode='42501'; end if;
 perform 1 from crm_external_connections where id=p_connection_id and provider_code='amazon_sp_api' and abilitata for update;
 if not found or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>10000 then raise exception 'Pagina spedizioni non valida'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  if coalesce(r->>'external_id','')!~'^\d{3}-\d{7}-\d{7}$' or nullif(r->>'shipped_at','') is null or (r->>'shipped_at')::timestamptz>now()+interval '1 day' then raise exception 'Spedizione non valida'; end if;
  insert into crm_amazon_shipment_dates(connection_id,external_id,shipped_at) values(p_connection_id,r->>'external_id',(r->>'shipped_at')::timestamptz)
  on conflict(connection_id,external_id) do update set shipped_at=greatest(crm_amazon_shipment_dates.shipped_at,excluded.shipped_at),updated_at=now();
 end loop;
 update crm_external_orders o set raw_summary=coalesce(o.raw_summary,'{}')||jsonb_build_object('fulfilled_at',s.shipped_at),ordered_at=s.shipped_at
 from crm_amazon_shipment_dates s where o.connection_id=p_connection_id and s.connection_id=o.connection_id and s.external_id=o.external_id and upper(o.stato)='SHIPPED' and o.fulfilled_at is distinct from s.shipped_at;
 update crm_external_connections set amazon_shipment_state=p_state,amazon_shipments_covered_at=coalesce(p_covered_at,amazon_shipments_covered_at) where id=p_connection_id;
end $$;
revoke all on function public.crm_store_amazon_shipment_dates_service(uuid,jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.crm_store_amazon_shipment_dates_service(uuid,jsonb,jsonb,timestamptz) to service_role;
create index crm_amazon_fulfilled_date_idx on public.crm_external_orders(connection_id,fulfilled_at) where fulfilled_at is not null;
-- Preserve purchase dates; mark legacy shipped rows until Amazon supplies an actual shipment.
update public.crm_external_orders o set raw_summary=coalesce(o.raw_summary,'{}')||jsonb_build_object('provider','amazon_sp_api','purchase_date',coalesce(o.raw_summary->>'purchase_date',o.ordered_at::text),'date_basis','purchase_unverified')
where exists(select 1 from public.crm_external_connections c where c.id=o.connection_id and c.provider_code='amazon_sp_api');
create or replace function public.crm_claim_amazon_cox_service(p_order_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare o public.crm_external_orders; delivery public.crm_amazon_cox_exports; claim_token uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Servizio riservato' using errcode='42501'; end if;
  select * into strict o from public.crm_external_orders where id=p_order_id for update;
  if lower(coalesce(o.stato,''))<>'shipped' or o.fulfilled_at is null or not exists(select 1 from public.crm_external_connections c
    where c.id=o.connection_id and c.provider_code='amazon_sp_api' and c.abilitata
      and c.amazon_cox_from is not null and (o.fulfilled_at at time zone 'Europe/Rome')::date>=c.amazon_cox_from) then
    raise exception 'Ordine Amazon spedito richiesto';
  end if;
  insert into public.crm_amazon_cox_exports(amazon_order_id,order_id,status)
    values(o.external_id,o.id,'blocked') on conflict(amazon_order_id) do nothing;
  select * into strict delivery from public.crm_amazon_cox_exports where amazon_order_id=o.external_id for update;
  if delivery.status<>'blocked' then
    update public.crm_external_orders set cox_status=delivery.status,cox_reference=delivery.reference,
      cox_error=coalesce(delivery.error,case when delivery.status='processing' then 'Invio in corso o interrotto: verificare Mexal prima di riprovare.' end)
      where id=o.id;
    return null;
  end if;
  claim_token:=gen_random_uuid();
  update public.crm_amazon_cox_exports set token=claim_token,order_id=o.id,status='processing',error=null,updated_at=now()
    where amazon_order_id=o.external_id;
  update public.crm_external_orders set cox_status='processing',cox_error='Invio in corso o interrotto: verificare Mexal prima di riprovare.' where id=o.id;
  return claim_token;
end $$;


notify pgrst,'reload schema';
commit;

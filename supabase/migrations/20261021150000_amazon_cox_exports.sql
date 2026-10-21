-- Amazon document delivery is independent of provider cursors and order-line replacement.
alter table public.crm_external_connections add column amazon_cox_state jsonb not null default '{}';
alter table public.crm_external_connections add column amazon_cox_from date;
-- First automatic emission boundary explicitly chosen by the owner.
update public.crm_external_connections set amazon_cox_from=date '2026-10-21'
  where provider_code='amazon_sp_api';
alter table public.crm_external_orders add column cox_status text not null default 'pending'
  check(cox_status in ('pending','processing','blocked','reconciliation_required','emitted'));
alter table public.crm_external_orders add column cox_reference jsonb;
alter table public.crm_external_orders add column cox_error text;
create index crm_amazon_cox_pending_idx on public.crm_external_orders(connection_id,id)
  where cox_status in ('pending','blocked') and lower(stato)='shipped';

create table public.crm_amazon_cox_exports(
  amazon_order_id text primary key,
  order_id uuid not null references public.crm_external_orders(id) on delete restrict,
  token uuid not null default gen_random_uuid(),
  status text not null check(status in ('processing','blocked','reconciliation_required','emitted')),
  reference jsonb, error text, updated_at timestamptz not null default now()
);
alter table public.crm_amazon_cox_exports enable row level security;
revoke all on public.crm_amazon_cox_exports from public,anon,authenticated;
grant all on public.crm_amazon_cox_exports to service_role;

-- Existing order permissions must never allow forging delivery state from a browser.
create function public.crm_guard_amazon_cox_fields() returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then
    if TG_OP='INSERT' then
      if new.cox_status<>'pending' or new.cox_reference is not null or new.cox_error is not null then
        raise exception 'Stato COX riservato al servizio' using errcode='42501';
      end if;
    elsif new.cox_status is distinct from old.cox_status or new.cox_reference is distinct from old.cox_reference or new.cox_error is distinct from old.cox_error then
      raise exception 'Stato COX riservato al servizio' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
create trigger crm_guard_amazon_cox_fields before insert or update on public.crm_external_orders
  for each row execute function public.crm_guard_amazon_cox_fields();

create function public.crm_claim_amazon_cox_service(p_order_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare o public.crm_external_orders; delivery public.crm_amazon_cox_exports; claim_token uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Servizio riservato' using errcode='42501'; end if;
  select * into strict o from public.crm_external_orders where id=p_order_id for update;
  if lower(coalesce(o.stato,''))<>'shipped' or not exists(select 1 from public.crm_external_connections c
    where c.id=o.connection_id and c.provider_code='amazon_sp_api' and c.abilitata
      and c.amazon_cox_from is not null and (o.ordered_at at time zone 'Europe/Rome')::date>=c.amazon_cox_from) then
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

create function public.crm_finish_amazon_cox_service(p_order_id uuid,p_token uuid,p_status text,p_reference jsonb,p_error text)
returns void language plpgsql security definer set search_path=public as $$
declare amazon_id text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Servizio riservato' using errcode='42501'; end if;
  if p_status not in ('blocked','reconciliation_required','emitted') then raise exception 'Stato COX non valido'; end if;
  if p_status='emitted' and (p_reference is null or coalesce((p_reference->>'number')::bigint,0)<=0
    or coalesce((p_reference->>'series')::integer,0)<=0 or coalesce(p_reference->>'year','')!~'^\d{4}$') then
    raise exception 'Riferimento COX obbligatorio';
  end if;
  update public.crm_amazon_cox_exports set status=p_status,reference=p_reference,error=left(p_error,500),updated_at=now()
    where order_id=p_order_id and token=p_token and status='processing' returning amazon_order_id into amazon_id;
  if not found then raise exception 'Claim COX non valido'; end if;
  update public.crm_external_orders o set cox_status=p_status,cox_reference=p_reference,cox_error=left(p_error,500)
    where external_id=amazon_id and exists(select 1 from public.crm_external_connections c
      where c.id=o.connection_id and c.provider_code='amazon_sp_api');
end $$;
revoke all on function public.crm_claim_amazon_cox_service(uuid) from public,anon,authenticated;
revoke all on function public.crm_finish_amazon_cox_service(uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.crm_claim_amazon_cox_service(uuid) to service_role;
grant execute on function public.crm_finish_amazon_cox_service(uuid,uuid,text,jsonb,text) to service_role;

-- Resolve uncertain COX only after verified readback; never unlock another POST.
create or replace function public.crm_finish_amazon_cox_service(p_order_id uuid,p_token uuid,p_status text,p_reference jsonb,p_error text)
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
    where order_id=p_order_id and token=p_token and (status='processing' or (status='reconciliation_required' and p_status='emitted')) returning amazon_order_id into amazon_id;
  if not found then raise exception 'Claim COX non valido'; end if;
  update public.crm_external_orders o set cox_status=p_status,cox_reference=p_reference,cox_error=left(p_error,500)
    where external_id=amazon_id and exists(select 1 from public.crm_external_connections c
      where c.id=o.connection_id and c.provider_code='amazon_sp_api');
end $$;

begin;

-- Keep the provider's complete order snapshot. Cancelled orders remain excluded
-- from commerce revenue by the existing aggregate and sales-day status filters.
create or replace function public.crm_import_commerce_page_service(
 target_connection_id uuid,target_run_id uuid,expected_state jsonb,
 resource_kind text,page_rows jsonb,next_state jsonb
) returns void language plpgsql security definer set search_path=public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then
  raise exception 'Servizio riservato' using errcode='42501';
 end if;
 -- The underlying importer validates the run and cursor and atomically upserts
 -- every order and its lines before advancing the cursor.
 perform crm_import_commerce_before_delta_service(
  target_connection_id,target_run_id,expected_state,resource_kind,page_rows,next_state);
 if resource_kind='orders' and exists(
  select 1 from crm_external_connections where id=target_connection_id and provider_code='amazon_sp_api'
 ) then
  update crm_external_orders o
   set cox_error='Annullamento Amazon ricevuto: verificare il COX già inviato.'
   where o.connection_id=target_connection_id
    and o.external_id in (select value->>'external_id' from jsonb_array_elements(page_rows)
     where upper(value->>'stato') in ('CANCELLED','CANCELED'))
    and exists(select 1 from crm_amazon_cox_exports e
     where e.order_id=o.id or e.amazon_order_id=o.external_id);
  if exists(select 1 from jsonb_array_elements(page_rows) r
   where not exists(select 1 from crm_external_orders o
    where o.connection_id=target_connection_id and o.external_id=r->>'external_id')) then
   raise exception 'Pagina Amazon incompleta: cursore non avanzato';
  end if;
 end if;
end $$;
revoke all on function public.crm_import_commerce_page_service(uuid,uuid,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.crm_import_commerce_page_service(uuid,uuid,jsonb,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

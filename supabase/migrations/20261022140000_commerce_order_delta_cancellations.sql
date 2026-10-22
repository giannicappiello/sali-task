begin;
alter function public.crm_import_commerce_page_service(uuid,uuid,jsonb,text,jsonb,jsonb) rename to crm_import_commerce_before_delta_service;
create function public.crm_import_commerce_page_service(target_connection_id uuid,target_run_id uuid,expected_state jsonb,resource_kind text,page_rows jsonb,next_state jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare filtered jsonb; cancelled jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Servizio riservato' using errcode='42501'; end if;
 if resource_kind='orders' and exists(select 1 from crm_external_connections where id=target_connection_id and provider_code='amazon_sp_api') then
  if jsonb_typeof(page_rows)<>'array' or jsonb_array_length(page_rows)>100 then raise exception 'Pagina non valida'; end if;
  select coalesce(jsonb_agg(value),'[]') into cancelled from jsonb_array_elements(page_rows) where upper(value->>'stato') in ('CANCELLED','CANCELED');
  select coalesce(jsonb_agg(value),'[]') into filtered from jsonb_array_elements(page_rows) where upper(coalesce(value->>'stato','')) not in ('CANCELLED','CANCELED');
 else filtered:=page_rows;cancelled:='[]'; end if;
 -- Validate lock, expected cursor, run and page before applying cancellation changes.
 perform crm_import_commerce_before_delta_service(target_connection_id,target_run_id,expected_state,resource_kind,filtered,next_state);
 delete from crm_external_orders o where o.connection_id=target_connection_id and o.external_id in (select value->>'external_id' from jsonb_array_elements(cancelled))
  and not exists(select 1 from crm_amazon_cox_exports e where e.order_id=o.id or e.amazon_order_id=o.external_id);
 -- Keep the audit link for any financial document already sent: never cancel or rewrite Mexal here.
 update crm_external_orders o set stato='CANCELLED',cox_error='Annullamento Amazon ricevuto: verificare il COX già inviato.'
 where o.connection_id=target_connection_id and o.external_id in (select value->>'external_id' from jsonb_array_elements(cancelled));
 if jsonb_array_length(cancelled)>0 then perform crm_import_commerce_before_delta_service(target_connection_id,target_run_id,next_state,'orders','[]',next_state); end if;
 return;
end $$;
revoke all on function public.crm_import_commerce_page_service(uuid,uuid,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.crm_import_commerce_page_service(uuid,uuid,jsonb,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

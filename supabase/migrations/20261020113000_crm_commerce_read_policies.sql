-- Preserve the existing module and owner/team rules, but evaluate request-wide
-- permissions as init plans rather than once per imported record.
do $$
declare t text; label text;
begin
  foreach t in array array['crm_external_accounts','crm_external_customers','crm_external_orders','crm_external_campaigns','crm_external_metrics'] loop
    label := case t when 'crm_external_accounts' then 'accounts' when 'crm_external_customers' then 'customers'
      when 'crm_external_orders' then 'orders' when 'crm_external_campaigns' then 'campaigns' else 'metrics' end;
    execute format('drop policy if exists %I on public.%I','digital '||label||' scoped',t);
    execute format($policy$
      create policy %2$I on public.%1$I for all to authenticated
      using (
        connection_id in (select c.id from public.crm_external_connections c
          where public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'lettura'))
        and (
          (select public.workspace_data_scope())->>'mode'='tutti'
          or %1$I.responsabile_id=(select public.workspace_current_profile_id())
          or ((select public.workspace_data_scope())->>'mode'='team' and (
            (select public.workspace_data_scope())->'user_ids' ? %1$I.responsabile_id::text
            or (select public.workspace_data_scope())->'department_ids' ? %1$I.reparto_id::text
          ))
        )
      ) with check (
        connection_id in (select c.id from public.crm_external_connections c
          where public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'scrittura'))
        and (
          (select public.workspace_data_scope())->>'mode'='tutti'
          or coalesce(%1$I.responsabile_id,(select public.workspace_current_profile_id()))=(select public.workspace_current_profile_id())
          or ((select public.workspace_data_scope())->>'mode'='team' and (
            (select public.workspace_data_scope())->'user_ids' ? coalesce(%1$I.responsabile_id,(select public.workspace_current_profile_id()))::text
            or (select public.workspace_data_scope())->'department_ids' ? %1$I.reparto_id::text
          ))
        )
      )
    $policy$,t,'digital '||label||' scoped');
  end loop;
end $$;

drop policy if exists "digital mappings read" on public.crm_product_mappings;
create policy "digital mappings read" on public.crm_product_mappings for select to authenticated using
  (connection_id in (select c.id from public.crm_external_connections c
    where public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'lettura')));
drop policy if exists "digital mappings write" on public.crm_product_mappings;
create policy "digital mappings write" on public.crm_product_mappings for all to authenticated using
  (connection_id in (select c.id from public.crm_external_connections c
    where public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'scrittura')))
  with check (connection_id in (select c.id from public.crm_external_connections c
    where public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'scrittura')));

drop policy if exists "commerce products scoped read" on public.crm_external_products;
create policy "commerce products scoped read" on public.crm_external_products for select to authenticated using
  (connection_id in (select c.id from public.crm_external_connections c
    where public.crm_row_visible(c.responsabile_id,c.reparto_id,'crm_online')));

begin;
-- Retain the existing write checks verbatim. Reads inherit the parent's complete
-- RLS scope, avoiding an extra permissions query for every imported product row.
do $$ declare old_read text; old_check text; begin
  select qual,with_check into strict old_read,old_check from pg_policies
    where schemaname='public' and tablename='crm_external_order_lines' and policyname='digital order lines through order';
  drop policy "digital order lines through order" on public.crm_external_order_lines;
  create policy "digital order lines read" on public.crm_external_order_lines for select to authenticated
    using(order_id in(select o.id from public.crm_external_orders o
      where o.connection_id in(select c.id from public.crm_external_connections c
        where public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'lettura'))
      and ((select public.workspace_data_scope())->>'mode'='tutti'
        or o.responsabile_id=(select public.workspace_current_profile_id())
        or ((select public.workspace_data_scope())->>'mode'='team' and
          ((select public.workspace_data_scope())->'user_ids' ? o.responsabile_id::text
          or (select public.workspace_data_scope())->'department_ids' ? o.reparto_id::text)))));
  execute 'create policy "digital order lines insert" on public.crm_external_order_lines for insert to authenticated with check ('||old_check||')';
  execute 'create policy "digital order lines update" on public.crm_external_order_lines for update to authenticated using ('||old_read||') with check ('||old_check||')';
  execute 'create policy "digital order lines delete" on public.crm_external_order_lines for delete to authenticated using ('||old_read||')';
end $$;
drop policy if exists club_identity_boundary on public.crm_external_order_lines;
create policy club_identity_boundary on public.crm_external_order_lines as restrictive for all to authenticated
using(not(select public.club_external_identity())) with check(not(select public.club_external_identity()));
commit;

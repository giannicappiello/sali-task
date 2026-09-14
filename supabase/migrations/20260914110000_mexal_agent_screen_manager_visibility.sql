begin;

-- Managing the Mexal Agents screen is a narrowly scoped administrative task.
-- It exposes every agent still active in Mexal so access can be enabled, but it
-- does not broaden the user's commercial scope for customers, orders or invoices.
create or replace function public.workspace_can_manage_mexal_agents()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(exists (
    select 1
    from public.utenti u
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
      and not exists (
        select 1 from public.workspace_customer_user_links link where link.user_id = u.id
      )
      and public.workspace_screen_level_for_user(u.id, 'integrazioni.mexal_agenti') = 'amministrazione'
  ), false);
$$;

revoke all on function public.workspace_can_manage_mexal_agents() from public, anon;
grant execute on function public.workspace_can_manage_mexal_agents() to authenticated, service_role;

drop policy if exists "department scope agents" on public.mexal_agenti;
create policy "department scope agents" on public.mexal_agenti
as restrictive for select to authenticated
using (
  (attivo_mexal is not false and (select public.workspace_can_manage_mexal_agents()))
  or (select public.workspace_commercial_read_all())
  or public.workspace_team_agent_visible(codice)
);

update public.workspace_access_revision set revision = revision + 1 where id;
notify pgrst, 'reload schema';

commit;

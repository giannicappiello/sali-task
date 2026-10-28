begin;

-- Customer membership is evaluated with the caller's identity, including
-- exclusions and the existing role/area rules.
create or replace function public.beauty_visible_legacy_pharmacy_ids()
returns table(farmacia_id uuid) language sql stable security definer set search_path=public
as $$
  select distinct b.legacy_farmacia_id from public.beauty_clienti_mexal b
  where b.legacy_farmacia_id is not null and b.codice_cliente in (
    select public.crm_visible_canonical_customer_codes()
  );
$$;

create or replace function public.crm_beauty_agent_customer_visible(target_account_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select coalesce(public.crm_has_module_level('crm_b2b','lettura') and exists (
    select 1 from public.integrazioni_utenti i
    where i.utente_id=public.workspace_current_profile_id() and i.modulo='report_giornate'
      and i.enabled is true and i.external_role='agent'
  ) and exists (
    select 1 from public.crm_accounts a where a.id=target_account_id and a.tipo='b2b'
      and a.codice_cliente_mexal in (select public.crm_visible_canonical_customer_codes())
  ),false);
$$;

-- Reading another consultant's visit does not grant editing or check-in rights.
create policy "beauty agent customer account read" on public.crm_accounts for select to authenticated
using (public.crm_beauty_agent_customer_visible(id));
create policy "beauty agent customer activity read" on public.crm_activities for select to authenticated
using (crm_tipo='b2b' and tipo='visita_beauty' and public.crm_beauty_agent_customer_visible(account_id));
create policy "beauty agent customer visit detail read" on public.crm_visit_details for select to authenticated
using (exists(select 1 from public.crm_activities a where a.id=activity_id
  and a.crm_tipo='b2b' and a.tipo='visita_beauty' and public.crm_beauty_agent_customer_visible(a.account_id)));

revoke all on function public.beauty_visible_legacy_pharmacy_ids(),public.crm_beauty_agent_customer_visible(uuid) from public,anon;
grant execute on function public.beauty_visible_legacy_pharmacy_ids(),public.crm_beauty_agent_customer_visible(uuid) to authenticated,service_role;
update public.workspace_access_revision set revision=revision+1 where id;
notify pgrst,'reload schema';
commit;

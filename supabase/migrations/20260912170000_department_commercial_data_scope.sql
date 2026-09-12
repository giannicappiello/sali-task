begin;

-- One authoritative scope for CRM, orders, invoices and BeautyDays.
-- Department membership is exclusively utenti_reparti, never the legacy reparto_id.
create or replace function public.workspace_data_scope()
returns jsonb language sql stable security definer set search_path = public
as $$
  with me as materialized (
    select u.id, coalesce(r.amministratore_workspace, false) as admin,
      coalesce(r.ambito_dati, 'propri') as data_scope, l.customer_code
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    left join public.workspace_customer_user_links l on l.user_id = u.id
    where u.auth_user_id = auth.uid() and u.attivo is not false
    limit 1
  ), effective_scope as (
    select id, customer_code,
      case when customer_code is not null then 'cliente'
        when admin or data_scope = 'tutti' then 'tutti'
        else data_scope end as mode
    from me
  ), departments as materialized (
    select d.id from public.reparti d cross join effective_scope s
    where d.attivo is not false and (
      s.mode = 'tutti' or (s.mode = 'team' and exists (
        select 1 from public.utenti_reparti ur
        where ur.utente_id = s.id and ur.reparto_id = d.id
      ))
    )
  ), members as materialized (
    select u.id, u.mexal_agente_id
    from public.utenti u cross join effective_scope s
    where u.attivo is not false and (
      u.id = s.id or s.mode = 'tutti' or (s.mode = 'team' and exists (
        select 1 from public.utenti_reparti ur
        where ur.utente_id = u.id and ur.reparto_id in (select id from departments)
      ))
    )
  ), agents as materialized (
    select a.id from public.mexal_agenti a cross join effective_scope s
    where a.attivo_mexal is not false and s.customer_code is null and (
      s.mode = 'tutti'
      or a.workspace_utente_id in (select id from members)
      or a.id in (select mexal_agente_id from members)
      or exists (
        select 1 from public.integrazioni_utenti i
        where i.utente_id in (select id from members)
          and i.enabled is true and i.mexal_agente_id = a.id
      )
      -- Keep explicit sales-manager assignments, independently of department membership.
      or (s.mode = 'team' and a.responsabile_utente_id = s.id)
    )
  )
  select jsonb_build_object(
    'mode', coalesce((select mode from effective_scope), 'propri'),
    'user_ids', coalesce((select jsonb_agg(id order by id) from members), '[]'::jsonb),
    'department_ids', coalesce((select jsonb_agg(id order by id) from departments), '[]'::jsonb),
    'agent_ids', coalesce((select jsonb_agg(id order by id) from agents), '[]'::jsonb),
    'customer_code', (select customer_code from effective_scope),
    'customer_codes', coalesce((select jsonb_build_array(customer_code)
      from effective_scope where customer_code is not null), '[]'::jsonb)
  );
$$;

create or replace function public.visible_mexal_agent_ids()
returns setof uuid language sql stable security definer set search_path = public
as $$
  select value::uuid from jsonb_array_elements_text(public.workspace_data_scope()->'agent_ids');
$$;

-- Operation level and role label must not turn a department director into a global reader.
create or replace function public.can_view_mexal_sales_invoice(p_agent_code text)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.workspace_data_scope()->>'mode' = 'tutti'
    or nullif(public.normalize_mexal_agent_code(p_agent_code), '') in (
      select public.normalize_mexal_agent_code(code)
      from public.visible_mexal_agent_codes() code
    );
$$;

create or replace function public.crm_row_visible(owner_id uuid, department_id uuid, target_module text)
returns boolean language sql stable security definer set search_path = public
as $$
  with scope as materialized (select public.workspace_data_scope() as data)
  select coalesce(public.crm_has_module_level(target_module, 'lettura') and (
    data->>'mode' = 'tutti' or owner_id = public.workspace_current_profile_id()
    or (data->>'mode' = 'team' and (
      data->'department_ids' ? department_id::text
      or (department_id is null and data->'user_ids' ? owner_id::text)
    ))
  ), false) from scope;
$$;

-- Existing permissive policies remain in place. These restrictions prevent a team
-- account from reading/writing other departments through direct table requests.
create or replace function public.workspace_team_agent_visible(agent_code text)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.workspace_data_scope()->>'mode' <> 'team'
    or nullif(public.normalize_mexal_agent_code(agent_code), '') in (
      select public.normalize_mexal_agent_code(code) from public.visible_mexal_agent_codes() code
    );
$$;

drop policy if exists "department scope customer orders" on public.ordini_testate;
create policy "department scope customer orders" on public.ordini_testate
as restrictive for all to authenticated
using (public.workspace_team_agent_visible(codice_agente_mexal))
with check (public.workspace_team_agent_visible(codice_agente_mexal));

drop policy if exists "department scope customer order lines" on public.ordini_righe;
create policy "department scope customer order lines" on public.ordini_righe
as restrictive for all to authenticated
using (public.workspace_data_scope()->>'mode' <> 'team'
  or exists (select 1 from public.ordini_testate h where h.id = ordine_id))
with check (public.workspace_data_scope()->>'mode' <> 'team'
  or exists (select 1 from public.ordini_testate h where h.id = ordine_id));

drop policy if exists "department scope order documents" on public.ordini_documenti_mexal;
create policy "department scope order documents" on public.ordini_documenti_mexal
as restrictive for select to authenticated
using (public.workspace_data_scope()->>'mode' <> 'team'
  or exists (select 1 from public.ordini_testate h where h.id = ordine_id));

drop policy if exists "department scope order document lines" on public.ordini_documenti_mexal_righe;
create policy "department scope order document lines" on public.ordini_documenti_mexal_righe
as restrictive for select to authenticated
using (public.workspace_data_scope()->>'mode' <> 'team'
  or exists (select 1 from public.ordini_documenti_mexal d where d.id = documento_mexal_id));

drop policy if exists "department scope customer directory" on public.ordini_clienti_cache;
create policy "department scope customer directory" on public.ordini_clienti_cache
as restrictive for select to authenticated
using (public.workspace_team_agent_visible(coalesce(
  nullif(codice_agente_mexal, ''),
  public.mexal_client_agent_code(json_mexal),
  public.mexal_client_agent_code(dati_mexal)
)));

drop policy if exists "department scope agents" on public.mexal_agenti;
create policy "department scope agents" on public.mexal_agenti
as restrictive for all to authenticated
using (public.workspace_team_agent_visible(codice))
with check (public.workspace_team_agent_visible(codice));

revoke all on function public.workspace_team_agent_visible(text) from public, anon;
grant execute on function public.workspace_team_agent_visible(text) to authenticated, service_role;
revoke all on function public.workspace_data_scope() from public, anon;
grant execute on function public.workspace_data_scope() to authenticated, service_role;
revoke all on function public.visible_mexal_agent_ids() from public, anon;
grant execute on function public.visible_mexal_agent_ids() to authenticated, service_role;

-- Invalidate open sessions immediately after this scope correction.
update public.workspace_access_revision set revision = revision + 1 where id;
notify pgrst, 'reload schema';

commit;

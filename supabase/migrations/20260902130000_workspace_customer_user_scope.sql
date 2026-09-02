begin;

create table if not exists public.workspace_customer_user_links (
  user_id uuid primary key references public.utenti(id) on delete cascade,
  customer_code text not null references public.ordini_clienti_cache(codice_cliente) on update cascade on delete restrict,
  linked_by uuid references public.utenti(id) on delete set null,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_customer_user_links_customer_code_not_blank check (btrim(customer_code) <> '')
);

create index if not exists workspace_customer_user_links_customer_idx
  on public.workspace_customer_user_links(customer_code);

alter table public.workspace_customer_user_links enable row level security;

drop policy if exists "admins manage customer user links" on public.workspace_customer_user_links;
create policy "admins manage customer user links"
on public.workspace_customer_user_links for all to authenticated
using (public.workspace_user_is_admin())
with check (public.workspace_user_is_admin());

drop policy if exists "users read own customer link" on public.workspace_customer_user_links;
create policy "users read own customer link"
on public.workspace_customer_user_links for select to authenticated
using (user_id = public.workspace_current_profile_id());

revoke all on table public.workspace_customer_user_links from public, anon;
grant select, insert, update, delete on table public.workspace_customer_user_links to authenticated;
grant all on table public.workspace_customer_user_links to service_role;

create or replace function public.workspace_current_customer_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select link.customer_code
  from public.utenti profile
  join public.workspace_customer_user_links link on link.user_id = profile.id
  where profile.auth_user_id = auth.uid()
    and profile.attivo is not false
  limit 1;
$$;

create or replace function public.workspace_customer_data_visible(target_customer_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with current_profile as materialized (
    select profile.id, link.customer_code
    from public.utenti profile
    left join public.workspace_customer_user_links link on link.user_id = profile.id
    where profile.auth_user_id = auth.uid()
      and profile.attivo is not false
    limit 1
  )
  select case
    when auth.role() = 'service_role' then true
    when not exists (select 1 from current_profile) then false
    when (select customer_code from current_profile) is null then true
    else upper(btrim(coalesce(target_customer_code, ''))) = upper(btrim((select customer_code from current_profile)))
  end;
$$;

create or replace function public.workspace_internal_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role' or exists (
    select 1
    from public.utenti profile
    left join public.workspace_customer_user_links link on link.user_id = profile.id
    where profile.auth_user_id = auth.uid()
      and profile.attivo is not false
      and link.user_id is null
  );
$$;

revoke all on function public.workspace_current_customer_code() from public, anon;
revoke all on function public.workspace_customer_data_visible(text) from public, anon;
revoke all on function public.workspace_internal_user() from public, anon;
grant execute on function public.workspace_current_customer_code() to authenticated, service_role;
grant execute on function public.workspace_customer_data_visible(text) to authenticated, service_role;
grant execute on function public.workspace_internal_user() to authenticated, service_role;

create or replace function public.visible_mexal_clients_for_me()
returns setof public.ordini_clienti_cache
language sql
stable
security definer
set search_path = public
as $$
  with me as materialized (
    select
      profile.id,
      role.ambito_dati,
      link.customer_code
    from public.utenti profile
    left join public.ruoli role on role.id = profile.ruolo_id
    left join public.workspace_customer_user_links link on link.user_id = profile.id
    where profile.auth_user_id = auth.uid()
      and profile.attivo is not false
    limit 1
  )
  select customer.*
  from public.ordini_clienti_cache customer
  cross join me
  where customer.attivo_mexal is true
    and (
      (
        me.customer_code is not null
        and upper(btrim(customer.codice_cliente)) = upper(btrim(me.customer_code))
      )
      or (
        me.customer_code is null
        and (
          coalesce(me.ambito_dati, 'propri') = 'tutti'
          or public.normalize_mexal_agent_code(coalesce(
            nullif(customer.codice_agente_mexal, ''),
            public.mexal_client_agent_code(customer.json_mexal),
            public.mexal_client_agent_code(customer.dati_mexal)
          )) in (
            select public.normalize_mexal_agent_code(code)
            from public.visible_mexal_agent_codes() code
          )
        )
      )
    );
$$;

revoke all on function public.visible_mexal_clients_for_me() from public, anon;
grant execute on function public.visible_mexal_clients_for_me() to authenticated, service_role;

create or replace function public.crm_visible_canonical_customer_codes()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  with me as materialized (
    select
      profile.codice_agente_mexal,
      coalesce(role.amministratore_workspace, false) as is_admin,
      coalesce(role.ambito_dati, 'propri') as data_scope,
      link.customer_code
    from public.utenti profile
    left join public.ruoli role on role.id = profile.ruolo_id
    left join public.workspace_customer_user_links link on link.user_id = profile.id
    where profile.auth_user_id = auth.uid()
      and profile.attivo is not false
    limit 1
  ), visible_agents as materialized (
    select public.normalize_mexal_agent_code(code) as code
    from public.visible_mexal_agent_codes() code
  )
  select customer.codice_cliente::text
  from public.ordini_clienti_cache customer
  where auth.role() = 'service_role'
    and customer.sync_excluded is false
  union
  select customer.codice_cliente::text
  from public.ordini_clienti_cache customer
  cross join me
  where customer.sync_excluded is false
    and (
    (
      me.customer_code is not null
      and upper(btrim(customer.codice_cliente)) = upper(btrim(me.customer_code))
    )
    or (
      me.customer_code is null
      and (
        me.is_admin
        or me.data_scope = 'tutti'
        or (
          nullif(public.normalize_mexal_agent_code(customer.codice_agente_mexal), '') is not null
          and (
            (
              me.data_scope = 'team'
              and public.normalize_mexal_agent_code(customer.codice_agente_mexal)
                in (select visible_agents.code from visible_agents)
            )
            or (
              me.data_scope <> 'team'
              and public.normalize_mexal_agent_code(customer.codice_agente_mexal) =
                public.normalize_mexal_agent_code(me.codice_agente_mexal)
            )
          )
        )
      )
    ));
$$;

revoke all on function public.crm_visible_canonical_customer_codes() from public, anon;
grant execute on function public.crm_visible_canonical_customer_codes() to authenticated, service_role;

create or replace function public.workspace_data_scope()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select
      profile.id,
      profile.reparto_id,
      profile.mexal_agente_id,
      coalesce(role.amministratore_workspace, false) as is_admin,
      coalesce(role.ambito_dati, 'propri') as data_scope,
      link.customer_code
    from public.utenti profile
    left join public.ruoli role on role.id = profile.ruolo_id
    left join public.workspace_customer_user_links link on link.user_id = profile.id
    where profile.auth_user_id = auth.uid()
      and profile.attivo is not false
    limit 1
  ), my_departments as (
    select relation.reparto_id
    from me
    join public.utenti_reparti relation on relation.utente_id = me.id
    where relation.reparto_id is not null
    union
    select reparto_id from me where reparto_id is not null
  ), effective_scope as (
    select
      case
        when customer_code is not null then 'cliente'
        when is_admin or data_scope = 'tutti' then 'tutti'
        else data_scope
      end as value,
      id,
      customer_code
    from me
  ), visible_departments as (
    select department.id
    from public.reparti department, effective_scope scope
    where department.attivo is not false and scope.value = 'tutti'
    union
    select reparto_id from my_departments, effective_scope scope
    where scope.value = 'team'
  ), visible_agents as (
    select agent.id
    from public.mexal_agenti agent, effective_scope scope
    where agent.attivo_mexal is not false and scope.value = 'tutti'
    union
    select me.mexal_agente_id from me, effective_scope scope
    where me.mexal_agente_id is not null and scope.customer_code is null
    union
    select agent.id
    from public.mexal_agenti agent
    join me on agent.responsabile_utente_id = me.id
    join effective_scope scope on scope.value in ('team', 'tutti')
    where agent.attivo_mexal is not false
    union
    select integration.mexal_agente_id
    from public.integrazioni_utenti integration
    join me on integration.utente_id = me.id
    join effective_scope scope on scope.customer_code is null
    where integration.enabled is true and integration.mexal_agente_id is not null
  ), visible_users as (
    select profile.id
    from public.utenti profile, effective_scope scope
    where profile.attivo is not false and scope.value = 'tutti'
    union
    select id from me
    union
    select distinct profile.id
    from public.utenti profile
    join effective_scope scope on scope.value = 'team'
    where profile.attivo is not false
      and (
        profile.reparto_id in (select reparto_id from my_departments)
        or exists (
          select 1 from public.utenti_reparti relation
          where relation.utente_id = profile.id
            and relation.reparto_id in (select reparto_id from my_departments)
        )
      )
    union
    select agent.workspace_utente_id
    from public.mexal_agenti agent
    where agent.id in (select id from visible_agents)
      and agent.workspace_utente_id is not null
  )
  select jsonb_build_object(
    'mode', coalesce((select value from effective_scope), 'propri'),
    'user_ids', coalesce((select jsonb_agg(distinct id) from visible_users where id is not null), '[]'::jsonb),
    'department_ids', coalesce((select jsonb_agg(distinct id) from visible_departments where id is not null), '[]'::jsonb),
    'agent_ids', coalesce((select jsonb_agg(distinct id) from visible_agents where id is not null), '[]'::jsonb),
    'customer_code', (select customer_code from effective_scope),
    'customer_codes', coalesce((select jsonb_build_array(customer_code) from effective_scope where customer_code is not null), '[]'::jsonb)
  );
$$;

revoke all on function public.workspace_data_scope() from public, anon;
grant execute on function public.workspace_data_scope() to authenticated, service_role;

-- Le tabelle ordini legacy non avevano un perimetro cliente uniforme.
-- Le policy permissive mantengono il comportamento degli utenti interni;
-- la policy RESTRICTIVE limita sempre un account collegato al proprio cliente.
alter table public.ordini_clienti_cache enable row level security;
alter table public.ordini_testate enable row level security;
alter table public.ordini_righe enable row level security;

drop policy if exists "active users read customer catalog" on public.ordini_clienti_cache;
create policy "active users read customer catalog"
on public.ordini_clienti_cache for select to authenticated
using (public.workspace_current_profile_id() is not null);
drop policy if exists "linked customer restricts customer catalog" on public.ordini_clienti_cache;
create policy "linked customer restricts customer catalog"
on public.ordini_clienti_cache as restrictive for select to authenticated
using (public.workspace_customer_data_visible(codice_cliente));

drop policy if exists "active users read customer orders" on public.ordini_testate;
create policy "active users read customer orders"
on public.ordini_testate for select to authenticated
using (public.workspace_current_profile_id() is not null);
drop policy if exists "linked customer restricts customer orders" on public.ordini_testate;
create policy "linked customer restricts customer orders"
on public.ordini_testate as restrictive for select to authenticated
using (public.workspace_customer_data_visible(codice_cliente));

drop policy if exists "internal users create customer orders" on public.ordini_testate;
create policy "internal users create customer orders"
on public.ordini_testate for insert to authenticated
with check (public.workspace_internal_user());
drop policy if exists "internal users update customer orders" on public.ordini_testate;
create policy "internal users update customer orders"
on public.ordini_testate for update to authenticated
using (public.workspace_internal_user()) with check (public.workspace_internal_user());
drop policy if exists "internal users delete customer orders" on public.ordini_testate;
create policy "internal users delete customer orders"
on public.ordini_testate for delete to authenticated
using (public.workspace_internal_user());

drop policy if exists "active users read customer order lines" on public.ordini_righe;
create policy "active users read customer order lines"
on public.ordini_righe for select to authenticated
using (public.workspace_current_profile_id() is not null);
drop policy if exists "linked customer restricts customer order lines" on public.ordini_righe;
create policy "linked customer restricts customer order lines"
on public.ordini_righe as restrictive for select to authenticated
using (exists (
  select 1 from public.ordini_testate parent
  where parent.id = ordine_id
    and public.workspace_customer_data_visible(parent.codice_cliente)
));
drop policy if exists "internal users create customer order lines" on public.ordini_righe;
create policy "internal users create customer order lines"
on public.ordini_righe for insert to authenticated
with check (public.workspace_internal_user());
drop policy if exists "internal users update customer order lines" on public.ordini_righe;
create policy "internal users update customer order lines"
on public.ordini_righe for update to authenticated
using (public.workspace_internal_user()) with check (public.workspace_internal_user());
drop policy if exists "internal users delete customer order lines" on public.ordini_righe;
create policy "internal users delete customer order lines"
on public.ordini_righe for delete to authenticated
using (public.workspace_internal_user());

grant select on public.ordini_clienti_cache, public.ordini_testate, public.ordini_righe to authenticated;

drop policy if exists "authenticated read mexal order documents" on public.ordini_documenti_mexal;
create policy "authenticated read mexal order documents"
on public.ordini_documenti_mexal for select to authenticated
using (
  public.workspace_internal_user()
  or exists (
    select 1 from public.ordini_testate parent
    where parent.id = ordine_id
      and public.workspace_customer_data_visible(parent.codice_cliente)
  )
);

drop policy if exists "authenticated read mexal order document lines" on public.ordini_documenti_mexal_righe;
create policy "authenticated read mexal order document lines"
on public.ordini_documenti_mexal_righe for select to authenticated
using (
  public.workspace_internal_user()
  or exists (
    select 1
    from public.ordini_documenti_mexal document
    join public.ordini_testate parent on parent.id = document.ordine_id
    where document.id = documento_mexal_id
      and public.workspace_customer_data_visible(parent.codice_cliente)
  )
);

drop policy if exists "fatture vendita visibili per organizzazione" on public.mexal_fatture_vendita;
create policy "fatture vendita visibili per organizzazione"
on public.mexal_fatture_vendita for select to authenticated
using (
  case
    when public.workspace_current_customer_code() is not null
      then public.workspace_customer_data_visible(codice_cliente)
    else public.can_view_mexal_sales_invoice(codice_agente_mexal)
  end
);

drop policy if exists "righe fatture vendita visibili per organizzazione" on public.mexal_fatture_vendita_righe;
create policy "righe fatture vendita visibili per organizzazione"
on public.mexal_fatture_vendita_righe for select to authenticated
using (exists (
  select 1
  from public.mexal_fatture_vendita invoice
  where invoice.id = fattura_id
    and (
      case
        when public.workspace_current_customer_code() is not null
          then public.workspace_customer_data_visible(invoice.codice_cliente)
        else public.can_view_mexal_sales_invoice(invoice.codice_agente_mexal)
      end
    )
));

comment on table public.workspace_customer_user_links is
  'Collegamento 1:1 tra account Workspace esterno e cliente canonico Mexal; non duplica l anagrafica cliente.';
comment on function public.workspace_customer_data_visible(text) is
  'Applica il perimetro cliente agli account collegati e lascia invariato il perimetro degli utenti interni.';

commit;

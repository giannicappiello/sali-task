begin;

create table if not exists public.workspace_moduli (
  codice text primary key,
  nome text not null,
  tipo text not null check (tipo in ('sistema', 'modulo', 'contenitore', 'vista_derivata', 'amministrazione')),
  area text,
  percorso text,
  provider text not null default 'workspace',
  sempre_disponibile boolean not null default false,
  assegnabile_reparto boolean not null default false,
  livello_self_service text check (livello_self_service in ('lettura', 'scrittura')),
  dipendenze text[] not null default '{}',
  attivo boolean not null default true,
  ordine integer not null default 0
);

insert into public.workspace_moduli
  (codice, nome, tipo, area, percorso, sempre_disponibile, assegnabile_reparto, livello_self_service, dipendenze, ordine)
values
  ('home', 'Home', 'sistema', 'workspace', '/home', true, false, 'lettura', '{}', 10),
  ('attivita', 'Attività', 'modulo', 'operativita', '/activities', true, false, 'scrittura', '{}', 20),
  ('beauty_days', 'Beauty Days', 'modulo', 'commerciale', '/farmacie/dashboard', false, true, null, '{}', 30),
  ('ordini_pr', 'Ordini PR', 'modulo', 'commerciale', '/ordini-prof', false, true, null, '{}', 40),
  ('ordini_ph', 'Ordini PH', 'modulo', 'commerciale', '/ordini-ph', false, true, null, '{}', 50),
  ('progremes', 'ProgreMES APS', 'modulo', 'produzione', '/progremes', false, true, null, '{}', 55),
  ('prodotti', 'Prodotti', 'modulo', 'anagrafiche', '/products', true, false, 'lettura', '{}', 60),
  ('documenti', 'Documenti', 'modulo', 'documentale', '/documentation', true, false, 'lettura', '{}', 70),
  ('messaggi', 'Messaggi', 'modulo', 'collaborazione', '/messages', true, false, 'scrittura', '{}', 80),
  ('notifiche', 'Notifiche', 'sistema', 'collaborazione', '/notifications', true, false, 'scrittura', '{}', 90),
  ('team', 'Team', 'modulo', 'organizzazione', '/team', false, true, null, '{}', 100),
  ('analisi_dati', 'Analisi dati', 'contenitore', 'analisi', '/analisi-dati', true, false, 'lettura', '{}', 110),
  ('analisi_attivita', 'Analisi attività', 'vista_derivata', 'analisi', '/analisi-dati/attivita', true, false, 'lettura', array['attivita'], 120),
  ('analisi_fatture', 'Analisi fatture', 'vista_derivata', 'analisi', '/analisi-dati/fatture', false, false, null, array['ordini_pr'], 130),
  ('analisi_ordini_ph', 'Analisi Ordini PH', 'vista_derivata', 'analisi', '/analisi-dati/ordini-ph', false, false, null, array['ordini_ph'], 140),
  ('analisi_beauty_days', 'Analisi Beauty Days', 'vista_derivata', 'analisi', '/analisi-dati/beauty-days', false, false, null, array['beauty_days'], 150),
  ('integrazioni', 'Integrazioni', 'amministrazione', 'amministrazione', '/integrations', false, false, null, '{}', 900)
on conflict (codice) do update set
  nome = excluded.nome,
  tipo = excluded.tipo,
  area = excluded.area,
  percorso = excluded.percorso,
  sempre_disponibile = excluded.sempre_disponibile,
  assegnabile_reparto = excluded.assegnabile_reparto,
  livello_self_service = excluded.livello_self_service,
  dipendenze = excluded.dipendenze,
  ordine = excluded.ordine;

update public.workspace_moduli set provider = 'progremes' where codice = 'progremes';

alter table public.workspace_moduli enable row level security;

drop policy if exists "authenticated read workspace module catalog" on public.workspace_moduli;
create policy "authenticated read workspace module catalog"
on public.workspace_moduli for select to authenticated using (true);

drop policy if exists "admins manage workspace module catalog" on public.workspace_moduli;
create policy "admins manage workspace module catalog"
on public.workspace_moduli for all to authenticated
using (public.workspace_user_is_admin())
with check (public.workspace_user_is_admin());

grant select on public.workspace_moduli to authenticated;

create table if not exists public.ruoli_moduli (
  ruolo_id uuid not null references public.ruoli(id) on delete cascade,
  modulo text not null references public.workspace_moduli(codice) on delete cascade,
  livello_accesso text not null default 'lettura'
    check (livello_accesso in ('lettura', 'scrittura', 'amministrazione')),
  aggiornato_il timestamptz not null default now(),
  primary key (ruolo_id, modulo)
);

alter table public.ruoli_moduli enable row level security;

drop policy if exists "authenticated read role module levels" on public.ruoli_moduli;
create policy "authenticated read role module levels"
on public.ruoli_moduli for select to authenticated using (true);

drop policy if exists "admins manage role module levels" on public.ruoli_moduli;
create policy "admins manage role module levels"
on public.ruoli_moduli for all to authenticated
using (public.workspace_user_is_admin())
with check (public.workspace_user_is_admin());

grant select, insert, update, delete on public.ruoli_moduli to authenticated;

insert into public.ruoli_moduli (ruolo_id, modulo, livello_accesso)
select
  r.id,
  m.codice,
  case
    when r.amministratore_workspace then 'amministrazione'
    else coalesce(r.livello_accesso, 'lettura')
  end
from public.ruoli r
cross join public.workspace_moduli m
where m.codice in (
  'attivita', 'beauty_days', 'ordini_pr', 'ordini_ph', 'prodotti',
  'documenti', 'messaggi', 'team', 'integrazioni'
)
on conflict (ruolo_id, modulo) do nothing;

create or replace function public.visible_workspace_team_user_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select u.id, u.reparto_id
    from public.utenti u
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
    limit 1
  ), my_departments as (
    select ur.reparto_id
    from me
    join public.utenti_reparti ur on ur.utente_id = me.id
    where ur.reparto_id is not null
    union
    select me.reparto_id from me where me.reparto_id is not null
  ), member_departments as (
    select u.id as utente_id, ur.reparto_id
    from public.utenti u
    join public.utenti_reparti ur on ur.utente_id = u.id
    where u.attivo is not false and ur.reparto_id is not null
    union
    select u.id, u.reparto_id
    from public.utenti u
    where u.attivo is not false and u.reparto_id is not null
  )
  select me.id from me
  union
  select distinct md.utente_id
  from member_departments md
  join my_departments mine on mine.reparto_id = md.reparto_id;
$$;

revoke all on function public.visible_workspace_team_user_ids() from public, anon;
grant execute on function public.visible_workspace_team_user_ids() to authenticated, service_role;

create or replace function public.sync_workspace_user_integrations(
  target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  role_config record;
  orders_role text;
  beauty_role text;
  beauty_enabled boolean;
begin
  select
    r.ambito_dati,
    r.accesso_come_beauty,
    r.amministratore_workspace,
    u.mexal_agente_id,
    coalesce(pr.livello_accesso, r.livello_accesso, 'lettura') as pr_access,
    coalesce(ph.livello_accesso, r.livello_accesso, 'lettura') as ph_access,
    coalesce(beauty.livello_accesso, r.livello_accesso, 'lettura') as beauty_access
  into role_config
  from public.utenti u
  left join public.ruoli r on r.id = u.ruolo_id
  left join public.ruoli_moduli pr on pr.ruolo_id = r.id and pr.modulo = 'ordini_pr'
  left join public.ruoli_moduli ph on ph.ruolo_id = r.id and ph.modulo = 'ordini_ph'
  left join public.ruoli_moduli beauty on beauty.ruolo_id = r.id and beauty.modulo = 'beauty_days'
  where u.id = target_user_id;

  orders_role := case coalesce(role_config.ambito_dati, 'propri')
    when 'tutti' then 'backoffice'
    when 'team' then 'area_manager'
    else 'agente'
  end;

  beauty_role := case
    when coalesce(role_config.amministratore_workspace, false) then 'admin'
    when coalesce(role_config.ambito_dati, 'propri') = 'tutti' then 'admin'
    when coalesce(role_config.accesso_come_beauty, false) then 'beauty'
    else 'agent'
  end;

  beauty_enabled :=
    public.workspace_module_enabled_for_user(target_user_id, 'beauty_days')
    and (
      coalesce(role_config.accesso_come_beauty, false)
      or coalesce(role_config.ambito_dati, 'propri') in ('team', 'tutti')
      or role_config.mexal_agente_id is not null
    );

  insert into public.integrazioni_utenti (
    utente_id, modulo, enabled, ruolo_ordini, access_level
  )
  values
    (
      target_user_id,
      'gestione_ordini_pr',
      public.workspace_module_enabled_for_user(target_user_id, 'ordini_pr'),
      orders_role,
      case role_config.pr_access when 'amministrazione' then 'admin' when 'scrittura' then 'write' else 'read' end
    ),
    (
      target_user_id,
      'gestione_ordini_ph',
      public.workspace_module_enabled_for_user(target_user_id, 'ordini_ph'),
      orders_role,
      case role_config.ph_access when 'amministrazione' then 'admin' when 'scrittura' then 'write' else 'read' end
    )
  on conflict (utente_id, modulo) do update
  set enabled = excluded.enabled,
      ruolo_ordini = excluded.ruolo_ordini,
      access_level = excluded.access_level;

  insert into public.integrazioni_utenti (
    utente_id, modulo, enabled, access_level, external_role
  )
  values (
    target_user_id,
    'report_giornate',
    beauty_enabled,
    case role_config.beauty_access when 'amministrazione' then 'admin' when 'scrittura' then 'write' else 'read' end,
    beauty_role
  )
  on conflict (utente_id, modulo) do update
  set enabled = excluded.enabled,
      access_level = excluded.access_level,
      external_role = excluded.external_role;
end;
$$;

create or replace function public.sync_all_workspace_integrations_from_role_modules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_row record;
begin
  for user_row in select id from public.utenti loop
    perform public.sync_workspace_user_integrations(user_row.id);
  end loop;
  return null;
end;
$$;

drop trigger if exists ruoli_moduli_sync_integrations on public.ruoli_moduli;
create trigger ruoli_moduli_sync_integrations
after insert or update or delete on public.ruoli_moduli
for each statement execute function public.sync_all_workspace_integrations_from_role_modules();

do $$
declare
  user_row record;
begin
  for user_row in select id from public.utenti loop
    perform public.sync_workspace_user_integrations(user_row.id);
  end loop;
end $$;

create or replace function public.workspace_access_context()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with current_profile as (
    select u.id, u.ruolo_id, u.reparto_id
    from public.utenti u
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
    limit 1
  ), departments as (
    select ur.reparto_id
    from current_profile cp
    join public.utenti_reparti ur on ur.utente_id = cp.id
    where ur.reparto_id is not null
    union
    select cp.reparto_id
    from current_profile cp
    where cp.reparto_id is not null
  )
  select jsonb_build_object(
    'role', coalesce((
      select jsonb_build_object(
        'id', r.id,
        'nome', r.nome,
        'amministratore_workspace', r.amministratore_workspace,
        'ambito_dati', r.ambito_dati,
        'livello_accesso', r.livello_accesso,
        'accesso_come_beauty', r.accesso_come_beauty
      )
      from current_profile cp
      left join public.ruoli r on r.id = cp.ruolo_id
    ), 'null'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(distinct p.codice)
      from current_profile cp
      join public.permessi_utente pu on pu.utente_id = cp.id
      join public.permessi p on p.id = pu.permesso_id
    ), '[]'::jsonb),
    'department_ids', coalesce((select jsonb_agg(d.reparto_id) from departments d), '[]'::jsonb),
    'modules', coalesce((
      select jsonb_agg(distinct rm.modulo)
      from departments d
      join public.reparti_moduli rm on rm.reparto_id = d.reparto_id
    ), '[]'::jsonb),
    'module_levels', coalesce((
      select jsonb_object_agg(rm.modulo, rm.livello_accesso)
      from current_profile cp
      join public.ruoli_moduli rm on rm.ruolo_id = cp.ruolo_id
    ), '{}'::jsonb)
  );
$$;

revoke all on function public.workspace_access_context() from public, anon;
grant execute on function public.workspace_access_context() to authenticated, service_role;

commit;

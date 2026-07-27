begin;

alter table public.ruoli
  add column if not exists ambito_dati text not null default 'propri',
  add column if not exists livello_accesso text not null default 'scrittura';

alter table public.ruoli
  drop constraint if exists ruoli_ambito_dati_check,
  add constraint ruoli_ambito_dati_check
    check (ambito_dati in ('propri', 'team', 'tutti')),
  drop constraint if exists ruoli_livello_accesso_check,
  add constraint ruoli_livello_accesso_check
    check (livello_accesso in ('lettura', 'scrittura', 'amministrazione'));

update public.ruoli
set
  ambito_dati = case
    when coalesce(livello, 0) >= 80
      or lower(btrim(coalesce(nome, ''))) in
        ('admin', 'administrator', 'amministratore', 'super admin', 'direzione')
      then 'tutti'
    when lower(btrim(coalesce(nome, ''))) in
        ('responsabile', 'area manager', 'area_manager')
      then 'team'
    else 'propri'
  end,
  livello_accesso = case
    when coalesce(livello, 0) >= 80
      or lower(btrim(coalesce(nome, ''))) in
        ('admin', 'administrator', 'amministratore', 'super admin', 'direzione')
      then 'amministrazione'
    else 'scrittura'
  end;

create table if not exists public.reparti_moduli (
  reparto_id uuid not null
    references public.reparti(id) on delete cascade,
  modulo text not null,
  creato_il timestamptz not null default now(),
  primary key (reparto_id, modulo),
  constraint reparti_moduli_modulo_check check (
    modulo in (
      'beauty_days',
      'ordini_pr',
      'ordini_ph',
      'prodotti',
      'documenti',
      'progetti',
      'attivita',
      'agenda',
      'messaggi',
      'report',
      'team'
    )
  )
);

alter table public.reparti_moduli enable row level security;

drop policy if exists "authenticated read department modules"
  on public.reparti_moduli;
create policy "authenticated read department modules"
on public.reparti_moduli
for select to authenticated
using (true);

drop policy if exists "admins manage department modules"
  on public.reparti_moduli;
create policy "admins manage department modules"
on public.reparti_moduli
for all to authenticated
using (
  exists (
    select 1
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
      and (
        coalesce(r.livello, 0) >= 80
        or lower(btrim(coalesce(r.nome, ''))) in
          ('admin', 'administrator', 'amministratore', 'super admin', 'direzione')
      )
  )
)
with check (
  exists (
    select 1
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
      and (
        coalesce(r.livello, 0) >= 80
        or lower(btrim(coalesce(r.nome, ''))) in
          ('admin', 'administrator', 'amministratore', 'super admin', 'direzione')
      )
  )
);

grant select, insert, update, delete on public.reparti_moduli to authenticated;

-- Conserva gli accessi attuali durante il passaggio al modello per reparto.
insert into public.reparti_moduli (reparto_id, modulo)
select distinct ur.reparto_id,
  case i.modulo
    when 'report_giornate' then 'beauty_days'
    when 'gestione_ordini_pr' then 'ordini_pr'
    when 'gestione_ordini_ph' then 'ordini_ph'
  end
from public.integrazioni_utenti i
join public.utenti_reparti ur on ur.utente_id = i.utente_id
where i.enabled is true
  and i.modulo in (
    'report_giornate',
    'gestione_ordini_pr',
    'gestione_ordini_ph'
  )
on conflict do nothing;

insert into public.reparti_moduli (reparto_id, modulo)
select distinct u.reparto_id,
  case i.modulo
    when 'report_giornate' then 'beauty_days'
    when 'gestione_ordini_pr' then 'ordini_pr'
    when 'gestione_ordini_ph' then 'ordini_ph'
  end
from public.integrazioni_utenti i
join public.utenti u on u.id = i.utente_id
where i.enabled is true
  and u.reparto_id is not null
  and i.modulo in (
    'report_giornate',
    'gestione_ordini_pr',
    'gestione_ordini_ph'
  )
on conflict do nothing;

with user_departments as (
  select u.id as utente_id, u.ruolo_id, ur.reparto_id
  from public.utenti u
  join public.utenti_reparti ur on ur.utente_id = u.id
  union
  select u.id, u.ruolo_id, u.reparto_id
  from public.utenti u
  where u.reparto_id is not null
),
department_permissions as (
  select distinct
    ud.reparto_id,
    case
      when p.codice like 'products.%' then 'prodotti'
      when p.codice like 'documentation.%' then 'documenti'
      when p.codice like 'messages.%' then 'messaggi'
      when p.codice like 'team.%' then 'team'
      when p.codice like 'agenda.%' then 'agenda'
      when p.codice like 'reports.%' then 'report'
      when p.codice like 'projects.%' then 'progetti'
      when p.codice like 'tasks.%'
        or p.codice = 'dashboard.read' then 'attivita'
    end as modulo
  from user_departments ud
  join public.permessi_ruolo pr on pr.ruolo_id = ud.ruolo_id
  join public.permessi p on p.id = pr.permesso_id
)
insert into public.reparti_moduli (reparto_id, modulo)
select reparto_id, modulo
from department_permissions
where modulo is not null
on conflict do nothing;

create or replace function public.workspace_module_enabled_for_user(
  target_user_id uuid,
  target_module text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select
      case
        when coalesce(r.livello, 0) >= 80
          or lower(btrim(coalesce(r.nome, ''))) in
            ('admin', 'administrator', 'amministratore', 'super admin', 'direzione')
          then true
        else exists (
          select 1
          from (
            select ur.reparto_id
            from public.utenti_reparti ur
            where ur.utente_id = u.id
            union
            select u.reparto_id
            where u.reparto_id is not null
          ) user_departments
          join public.reparti_moduli rm
            on rm.reparto_id = user_departments.reparto_id
          where rm.modulo = target_module
        )
      end
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.id = target_user_id
      and u.attivo is not false
  ), false);
$$;

create or replace function public.workspace_module_enabled_for_me(
  target_module text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.workspace_module_enabled_for_user(u.id, target_module)
    from public.utenti u
    where u.auth_user_id = auth.uid()
  ), false);
$$;

revoke all on function public.workspace_module_enabled_for_user(uuid, text)
  from public, anon;
revoke all on function public.workspace_module_enabled_for_me(text)
  from public, anon;
grant execute on function public.workspace_module_enabled_for_user(uuid, text)
  to authenticated, service_role;
grant execute on function public.workspace_module_enabled_for_me(text)
  to authenticated, service_role;

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
begin
  select
    r.ambito_dati,
    r.livello_accesso,
    u.mexal_agente_id
  into role_config
  from public.utenti u
  left join public.ruoli r on r.id = u.ruolo_id
  where u.id = target_user_id;

  orders_role := case coalesce(role_config.ambito_dati, 'propri')
    when 'tutti' then 'backoffice'
    when 'team' then 'area_manager'
    else 'agente'
  end;

  beauty_role := case
    when coalesce(role_config.ambito_dati, 'propri') = 'tutti' then 'admin'
    when coalesce(role_config.ambito_dati, 'propri') = 'team'
      or role_config.mexal_agente_id is not null then 'agent'
    else 'beauty'
  end;

  insert into public.integrazioni_utenti (
    utente_id, modulo, enabled, ruolo_ordini
  )
  values
    (
      target_user_id,
      'gestione_ordini_pr',
      public.workspace_module_enabled_for_user(target_user_id, 'ordini_pr'),
      orders_role
    ),
    (
      target_user_id,
      'gestione_ordini_ph',
      public.workspace_module_enabled_for_user(target_user_id, 'ordini_ph'),
      orders_role
    )
  on conflict (utente_id, modulo) do update
  set enabled = excluded.enabled,
      ruolo_ordini = excluded.ruolo_ordini;

  insert into public.integrazioni_utenti (
    utente_id,
    modulo,
    enabled,
    access_level,
    external_role
  )
  values (
    target_user_id,
    'report_giornate',
    public.workspace_module_enabled_for_user(target_user_id, 'beauty_days'),
    case coalesce(role_config.livello_accesso, 'scrittura')
      when 'amministrazione' then 'admin'
      when 'scrittura' then 'write'
      else 'read'
    end,
    beauty_role
  )
  on conflict (utente_id, modulo) do update
  set enabled = excluded.enabled,
      access_level = excluded.access_level,
      external_role = excluded.external_role;
end;
$$;

revoke all on function public.sync_workspace_user_integrations(uuid)
  from public, anon;
grant execute on function public.sync_workspace_user_integrations(uuid)
  to authenticated, service_role;

create or replace function public.sync_all_workspace_integrations()
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

drop trigger if exists reparti_moduli_sync_integrations
  on public.reparti_moduli;
create trigger reparti_moduli_sync_integrations
after insert or update or delete on public.reparti_moduli
for each statement execute function public.sync_all_workspace_integrations();

drop trigger if exists ruoli_sync_integrations on public.ruoli;
create trigger ruoli_sync_integrations
after update of ambito_dati, livello_accesso on public.ruoli
for each statement execute function public.sync_all_workspace_integrations();

drop trigger if exists utenti_reparti_sync_integrations
  on public.utenti_reparti;
create trigger utenti_reparti_sync_integrations
after insert or update or delete on public.utenti_reparti
for each statement execute function public.sync_all_workspace_integrations();

drop trigger if exists utenti_workspace_access_sync_integrations
  on public.utenti;
create trigger utenti_workspace_access_sync_integrations
after insert or update of ruolo_id, reparto_id, attivo, mexal_agente_id
on public.utenti
for each statement execute function public.sync_all_workspace_integrations();

do $$
declare
  user_row record;
begin
  for user_row in select id from public.utenti loop
    perform public.sync_workspace_user_integrations(user_row.id);
  end loop;
end;
$$;

commit;

begin;

alter table public.utenti
  add column if not exists responsabile_utente_id uuid references public.utenti(id) on delete set null;

create table if not exists public.workspace_eccezioni_utente (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references public.utenti(id) on delete cascade,
  ambito text not null check (ambito in ('area','modulo','schermata','permesso')),
  codice text not null,
  decisione text not null check (decisione in ('consenti','nega')),
  livello_accesso text check (livello_accesso in ('lettura','scrittura','amministrazione')),
  motivazione text,
  valida_fino_a timestamptz,
  creata_da uuid references public.utenti(id) on delete set null,
  creata_il timestamptz not null default now(),
  aggiornata_il timestamptz not null default now(),
  unique (utente_id,ambito,codice)
);

create index if not exists workspace_eccezioni_utente_lookup_idx
  on public.workspace_eccezioni_utente (utente_id,ambito,codice);

alter table public.workspace_eccezioni_utente enable row level security;

drop policy if exists "admins manage personal access exceptions" on public.workspace_eccezioni_utente;
create policy "admins manage personal access exceptions"
on public.workspace_eccezioni_utente for all to authenticated
using (public.workspace_user_is_admin())
with check (public.workspace_user_is_admin());

drop policy if exists "users read own personal access exceptions" on public.workspace_eccezioni_utente;
create policy "users read own personal access exceptions"
on public.workspace_eccezioni_utente for select to authenticated
using (
  public.workspace_user_is_admin()
  or utente_id=public.workspace_current_profile_id()
);

grant select,insert,update,delete on public.workspace_eccezioni_utente to authenticated;

create or replace function public.workspace_personal_exception(
  target_user_id uuid,
  target_scope text,
  target_code text
)
returns table(decisione text,livello_accesso text,motivazione text,valida_fino_a timestamptz)
language sql
stable
security definer
set search_path=public
as $$
  select e.decisione,e.livello_accesso,e.motivazione,e.valida_fino_a
  from public.workspace_eccezioni_utente e
  where e.utente_id=target_user_id
    and e.ambito=target_scope
    and e.codice=target_code
    and (e.valida_fino_a is null or e.valida_fino_a>now())
  limit 1
$$;

revoke all on function public.workspace_personal_exception(uuid,text,text) from public,anon;
grant execute on function public.workspace_personal_exception(uuid,text,text) to authenticated,service_role;

create or replace function public.workspace_area_access_codes(target_auth_user_id uuid default auth.uid())
returns text[]
language sql
stable
security definer
set search_path=public
as $$
  with current_profile as (
    select u.id,u.ruolo_id,u.reparto_id,
      coalesce(r.amministratore_workspace,false) as is_admin
    from public.utenti u
    left join public.ruoli r on r.id=u.ruolo_id
    where u.auth_user_id=target_auth_user_id and u.attivo is not false
    limit 1
  ), departments as (
    select ur.reparto_id from public.utenti_reparti ur join current_profile u on u.id=ur.utente_id
    union
    select u.reparto_id from current_profile u where u.reparto_id is not null
  ), inherited as (
    select a.codice from public.workspace_aree a cross join current_profile u where a.attiva and u.is_admin
    union
    select ra.area_codice from public.workspace_ruoli_aree ra join current_profile u on u.ruolo_id=ra.ruolo_id
    union
    select da.area_codice from public.workspace_reparti_aree da join departments d on d.reparto_id=da.reparto_id
  ), allowed as (
    select i.codice from inherited i
    where not exists (
      select 1 from current_profile u
      join public.workspace_eccezioni_utente e on e.utente_id=u.id
      where not u.is_admin and e.ambito='area' and e.codice=i.codice and e.decisione='nega'
        and (e.valida_fino_a is null or e.valida_fino_a>now())
    )
    union
    select e.codice from current_profile u
    join public.workspace_eccezioni_utente e on e.utente_id=u.id
    where not u.is_admin and e.ambito='area' and e.decisione='consenti'
      and (e.valida_fino_a is null or e.valida_fino_a>now())
  )
  select coalesce(array_agg(distinct allowed.codice),'{}'::text[]) from allowed
$$;

create or replace function public.workspace_module_enabled_for_user(target_user_id uuid,target_module text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  with target as (
    select u.id,u.ruolo_id,u.reparto_id,u.auth_user_id,
      coalesce(r.amministratore_workspace,false) as is_admin
    from public.utenti u
    left join public.ruoli r on r.id=u.ruolo_id
    where u.id=target_user_id and u.attivo is not false
    limit 1
  ), exception as (
    select e.decisione
    from target t join public.workspace_eccezioni_utente e on e.utente_id=t.id
    where e.ambito='modulo' and e.codice=target_module
      and (e.valida_fino_a is null or e.valida_fino_a>now())
    limit 1
  ), departments as (
    select ur.reparto_id from public.utenti_reparti ur join target t on t.id=ur.utente_id
    union
    select t.reparto_id from target t where t.reparto_id is not null
  )
  select coalesce((
    select case
      when t.is_admin then true
      when (select decisione from exception)='consenti' then true
      when (select decisione from exception)='nega' then false
      when m.attivo is false then false
      when m.area is not null and not (m.area=any(public.workspace_area_access_codes(t.auth_user_id))) then false
      when m.sempre_disponibile then true
      when not m.assegnabile_reparto then true
      else exists (
        select 1 from departments d
        join public.reparti_moduli rm on rm.reparto_id=d.reparto_id
        where rm.modulo=target_module
      )
    end
    from target t
    join public.workspace_moduli m on m.codice=target_module
  ),false)
$$;

revoke all on function public.workspace_module_enabled_for_user(uuid,text) from public,anon;
grant execute on function public.workspace_module_enabled_for_user(uuid,text) to authenticated,service_role;

create or replace function public.workspace_access_context()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
  with current_profile as (
    select u.id,u.ruolo_id,u.reparto_id,coalesce(r.amministratore_workspace,false) as is_admin
    from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
    where u.auth_user_id=auth.uid() and u.attivo is not false limit 1
  ), departments as (
    select ur.reparto_id from current_profile cp join public.utenti_reparti ur on ur.utente_id=cp.id where ur.reparto_id is not null
    union select cp.reparto_id from current_profile cp where cp.reparto_id is not null
  )
  select jsonb_build_object(
    'role',coalesce((select to_jsonb(r) from current_profile cp left join public.ruoli r on r.id=cp.ruolo_id),'null'::jsonb),
    'permissions',coalesce((
      select jsonb_agg(distinct p.codice)
      from current_profile cp join public.permessi_utente pu on pu.utente_id=cp.id join public.permessi p on p.id=pu.permesso_id
      where not exists (
        select 1 from public.workspace_eccezioni_utente e
        where e.utente_id=cp.id and e.ambito='permesso' and e.codice=p.codice and e.decisione='nega'
          and (e.valida_fino_a is null or e.valida_fino_a>now())
      )
    ),'[]'::jsonb) || coalesce((
      select jsonb_agg(e.codice) from current_profile cp join public.workspace_eccezioni_utente e on e.utente_id=cp.id
      where e.ambito='permesso' and e.decisione='consenti' and (e.valida_fino_a is null or e.valida_fino_a>now())
    ),'[]'::jsonb),
    'department_ids',coalesce((select jsonb_agg(d.reparto_id) from departments d),'[]'::jsonb),
    'modules',coalesce((
      select jsonb_agg(m.codice order by m.ordine,m.nome)
      from current_profile cp cross join public.workspace_moduli m
      where public.workspace_module_enabled_for_user(cp.id,m.codice)
    ),'[]'::jsonb),
    'module_levels',coalesce((
      select jsonb_object_agg(m.codice,
        case when cp.is_admin then 'amministrazione'
          else coalesce(e.livello_accesso,rm.livello_accesso,r.livello_accesso,'lettura') end)
      from current_profile cp
      join public.ruoli r on r.id=cp.ruolo_id
      cross join public.workspace_moduli m
      left join public.ruoli_moduli rm on rm.ruolo_id=cp.ruolo_id and rm.modulo=m.codice
      left join public.workspace_eccezioni_utente e on e.utente_id=cp.id and e.ambito='modulo' and e.codice=m.codice
        and (e.valida_fino_a is null or e.valida_fino_a>now())
      group by cp.is_admin
    ),'{}'::jsonb),
    'exceptions',coalesce((
      select jsonb_agg(jsonb_build_object('scope',e.ambito,'code',e.codice,'decision',e.decisione,'level',e.livello_accesso,'expires_at',e.valida_fino_a))
      from current_profile cp join public.workspace_eccezioni_utente e on e.utente_id=cp.id
      where e.valida_fino_a is null or e.valida_fino_a>now()
    ),'[]'::jsonb)
  )
$$;

revoke all on function public.workspace_access_context() from public,anon;
grant execute on function public.workspace_access_context() to authenticated,service_role;

insert into public.workspace_schermate
  (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,metadati,ultima_sincronizzazione)
values
  ('impostazioni.utenti_accessi','Utenti e accessi','Dati, sicurezza, organizzazione, eccezioni personali e AI per ciascun utente.','workspace','/settings/users','settings.users-access',false,true,10,'amministrazione','{"admin_only":true}'::jsonb,now()),
  ('impostazioni.regole_accesso','Regole e profili di accesso','Profili, ruoli, aree, reparti e livelli operativi.','workspace','/settings/access-rules','settings.access-rules',false,true,20,'amministrazione','{"admin_only":true}'::jsonb,now()),
  ('impostazioni.verifica_accessi','Verifica accessi','Simulazione motivata del menu, dei moduli, delle schermate e delle funzioni AI visibili a un utente.','workspace','/settings/access-check','settings.access-check',false,true,30,'amministrazione','{"admin_only":true}'::jsonb,now())
on conflict (codice) do update set
  nome=excluded.nome,descrizione=excluded.descrizione,percorso=excluded.percorso,
  chiave_componente=excluded.chiave_componente,attiva=true,area=excluded.area,
  metadati=workspace_schermate.metadati || excluded.metadati,ultima_sincronizzazione=now();

delete from public.workspace_moduli_schermate
where modulo_codice='impostazioni' and schermata_codice in ('impostazioni.team','impostazioni.organizzazione');

insert into public.workspace_moduli_schermate (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values
  ('impostazioni','impostazioni.utenti_accessi',10,false,true),
  ('impostazioni','impostazioni.regole_accesso',20,false,true),
  ('impostazioni','impostazioni.verifica_accessi',30,false,true)
on conflict (modulo_codice,schermata_codice) do update set
  ordine=excluded.ordine,predefinita=false,visibile_menu=true;

update public.workspace_schermate set attiva=false
where codice in ('impostazioni.team','impostazioni.organizzazione');

commit;

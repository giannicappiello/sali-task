begin;

create or replace function public.normalize_mexal_agent_code(value text)
returns text
language sql
immutable
as $$
  select case
    when nullif(btrim(value), '') is null then null
    when btrim(value) ~ '^[0-9]+([.][0-9]+)?$' then
      coalesce(
        nullif(
          ltrim(
            regexp_replace(btrim(value), '^.*[.]', ''),
            '0'
          ),
          ''
        ),
        '0'
      )
    else upper(btrim(value))
  end;
$$;

create or replace function public.mexal_client_agent_code(payload jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(upper(btrim(coalesce(
    nullif(payload #>> '{cod_agente_1,0,2}', ''),
    nullif(payload #>> '{cod_agente_1,0,1}', ''),
    nullif(payload #>> '{cod_agente_1,0,0}', ''),
    nullif(payload #>> '{cod_agente_1,0}', ''),
    nullif(payload ->> 'cod_agente_1', ''),
    nullif(payload #>> '{codice_agente_1,0,2}', ''),
    nullif(payload #>> '{codice_agente_1,0,1}', ''),
    nullif(payload #>> '{codice_agente_1,0,0}', ''),
    nullif(payload #>> '{codice_agente_1,0}', ''),
    nullif(payload ->> 'codice_agente_1', ''),
    nullif(payload ->> 'codice_agente', ''),
    nullif(payload ->> 'cod_agente', ''),
    nullif(payload ->> 'agente_1', ''),
    nullif(payload ->> 'agente', ''),
    nullif(payload ->> 'codagente', ''),
    nullif(payload #>> '{cod_agente_2,0,2}', ''),
    nullif(payload #>> '{cod_agente_2,0,1}', ''),
    nullif(payload #>> '{cod_agente_2,0,0}', ''),
    nullif(payload #>> '{cod_agente_2,0}', ''),
    nullif(payload ->> 'cod_agente_2', '')
  ))), '');
$$;

update public.ordini_clienti_cache c
set codice_agente_mexal = coalesce(
  public.mexal_client_agent_code(c.json_mexal),
  public.mexal_client_agent_code(c.dati_mexal),
  c.codice_agente_mexal
)
where coalesce(
  public.mexal_client_agent_code(c.json_mexal),
  public.mexal_client_agent_code(c.dati_mexal)
) is not null;

with unique_agents as (
  select
    min(a.codice) as codice,
    public.normalize_mexal_agent_code(a.codice) as normalized_code
  from public.mexal_agenti a
  where a.attivo_mexal is not false
  group by public.normalize_mexal_agent_code(a.codice)
  having count(*) = 1
)
update public.ordini_clienti_cache c
set codice_agente_mexal = a.codice
from unique_agents a
where public.normalize_mexal_agent_code(c.codice_agente_mexal)
    = a.normalized_code
  and c.codice_agente_mexal is distinct from a.codice;

create or replace function public.canonicalize_mexal_client_agent_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  canonical_code text;
begin
  if nullif(btrim(coalesce(new.codice_agente_mexal, '')), '') is null then
    return new;
  end if;

  select min(a.codice)
  into canonical_code
  from public.mexal_agenti a
  where a.attivo_mexal is not false
    and public.normalize_mexal_agent_code(a.codice)
      = public.normalize_mexal_agent_code(new.codice_agente_mexal)
  having count(*) = 1;

  if canonical_code is not null then
    new.codice_agente_mexal := canonical_code;
  end if;
  return new;
end;
$$;

drop trigger if exists ordini_clienti_canonical_agent
  on public.ordini_clienti_cache;
create trigger ordini_clienti_canonical_agent
before insert or update of codice_agente_mexal
on public.ordini_clienti_cache
for each row execute function public.canonicalize_mexal_client_agent_code();

create or replace function public.visible_mexal_agent_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select
      u.id,
      u.mexal_agente_id,
      coalesce(r.ambito_dati, 'propri') as ambito_dati
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
  )
  select a.id
  from public.mexal_agenti a, me
  where a.attivo_mexal is not false
    and me.ambito_dati = 'tutti'
  union
  select me.mexal_agente_id
  from me
  where me.mexal_agente_id is not null
  union
  select a.id
  from public.mexal_agenti a
  join me on a.responsabile_utente_id = me.id
  where a.attivo_mexal is not false
    and me.ambito_dati in ('team', 'tutti')
  union
  select iu.mexal_agente_id
  from public.integrazioni_utenti iu
  join me on me.id = iu.utente_id
  where iu.modulo = 'report_giornate'
    and iu.enabled is true
    and iu.mexal_agente_id is not null;
$$;

create or replace function public.visible_mexal_clients_for_me()
returns setof public.ordini_clienti_cache
language sql
stable
security definer
set search_path = public
as $$
  select c.*
  from public.ordini_clienti_cache c
  where c.attivo_mexal is true
    and (
      public.normalize_mexal_agent_code(coalesce(
        nullif(c.codice_agente_mexal, ''),
        public.mexal_client_agent_code(c.json_mexal),
        public.mexal_client_agent_code(c.dati_mexal)
      )) in (
        select public.normalize_mexal_agent_code(code)
        from public.visible_mexal_agent_codes() as code
      )
      or exists (
        select 1
        from public.utenti u
        left join public.ruoli r on r.id = u.ruolo_id
        where u.auth_user_id = auth.uid()
          and u.attivo is not false
          and coalesce(r.ambito_dati, 'propri') = 'tutti'
      )
    );
$$;

revoke all on function public.normalize_mexal_agent_code(text)
  from public, anon;
grant execute on function public.normalize_mexal_agent_code(text)
  to authenticated, service_role;
revoke all on function public.visible_mexal_clients_for_me()
  from public, anon;
grant execute on function public.visible_mexal_clients_for_me()
  to authenticated, service_role;

commit;

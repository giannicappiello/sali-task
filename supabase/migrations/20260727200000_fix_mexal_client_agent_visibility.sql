begin;

create or replace function public.mexal_client_agent_code(payload jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(upper(btrim(coalesce(
    nullif(payload #>> '{cod_agente_1,0,0}', ''),
    nullif(payload #>> '{cod_agente_1,0}', ''),
    nullif(payload ->> 'cod_agente_1', ''),
    nullif(payload #>> '{codice_agente_1,0,0}', ''),
    nullif(payload #>> '{codice_agente_1,0}', ''),
    nullif(payload ->> 'codice_agente_1', ''),
    nullif(payload ->> 'codice_agente', ''),
    nullif(payload ->> 'cod_agente', ''),
    nullif(payload ->> 'agente_1', ''),
    nullif(payload ->> 'agente', ''),
    nullif(payload ->> 'codagente', ''),
    nullif(payload #>> '{cod_agente_2,0,0}', ''),
    nullif(payload #>> '{cod_agente_2,0}', ''),
    nullif(payload ->> 'cod_agente_2', '')
  ))), '');
$$;

revoke all on function public.mexal_client_agent_code(jsonb) from public, anon;
grant execute on function public.mexal_client_agent_code(jsonb)
  to authenticated, service_role;

update public.ordini_clienti_cache c
set codice_agente_mexal = coalesce(
  public.mexal_client_agent_code(c.json_mexal),
  public.mexal_client_agent_code(c.dati_mexal)
)
where coalesce(
    public.mexal_client_agent_code(c.json_mexal),
    public.mexal_client_agent_code(c.dati_mexal)
  ) is not null
  and upper(btrim(coalesce(c.codice_agente_mexal, '')))
      is distinct from coalesce(
        public.mexal_client_agent_code(c.json_mexal),
        public.mexal_client_agent_code(c.dati_mexal)
      );

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
      upper(btrim(coalesce(
        nullif(c.codice_agente_mexal, ''),
        public.mexal_client_agent_code(c.json_mexal),
        public.mexal_client_agent_code(c.dati_mexal)
      ))) in (
        select upper(btrim(code))
        from public.visible_mexal_agent_codes() as code
      )
      or exists (
        select 1
        from public.utenti u
        left join public.ruoli r on r.id = u.ruolo_id
        where u.auth_user_id = auth.uid()
          and u.attivo is not false
          and (
            coalesce(r.livello, 0) >= 80
            or lower(coalesce(r.nome, '')) in
              ('admin', 'administrator', 'amministratore', 'super admin', 'direzione')
          )
      )
    );
$$;

revoke all on function public.visible_mexal_clients_for_me() from public, anon;
grant execute on function public.visible_mexal_clients_for_me()
  to authenticated, service_role;

commit;

begin;

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
      c.codice_agente_mexal in (select public.visible_mexal_agent_codes())
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
grant execute on function public.visible_mexal_clients_for_me() to authenticated, service_role;

commit;

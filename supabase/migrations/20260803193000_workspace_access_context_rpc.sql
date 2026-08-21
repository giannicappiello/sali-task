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
      join public.permessi_ruolo pr on pr.ruolo_id = cp.ruolo_id
      join public.permessi p on p.id = pr.permesso_id
    ), '[]'::jsonb),
    'department_ids', coalesce((
      select jsonb_agg(d.reparto_id) from departments d
    ), '[]'::jsonb),
    'modules', coalesce((
      select jsonb_agg(distinct rm.modulo)
      from departments d
      join public.reparti_moduli rm on rm.reparto_id = d.reparto_id
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.workspace_access_context() from public, anon;
grant execute on function public.workspace_access_context() to authenticated, service_role;

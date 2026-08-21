begin;

create or replace function public.chat_create_department_group(
  p_titolo text,
  p_reparto_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  profilo_id uuid;
  nuova_conversazione_id uuid;
  reparti_richiesti integer;
  reparti_trovati integer;
begin
  select u.id into profilo_id
  from public.utenti u
  where u.auth_user_id = auth.uid()
    and u.attivo is not false;

  if profilo_id is null then
    raise exception 'Profilo Workspace non valido';
  end if;

  if not public.workspace_module_enabled_for_user(profilo_id, 'messaggi') then
    raise exception 'Accesso al modulo Messaggi non autorizzato';
  end if;

  if nullif(btrim(p_titolo), '') is null then
    raise exception 'Il nome della chat e obbligatorio';
  end if;

  if char_length(btrim(p_titolo)) > 120 then
    raise exception 'Il nome della chat non puo superare 120 caratteri';
  end if;

  select count(*) into reparti_richiesti
  from (
    select distinct requested.reparto_id
    from unnest(coalesce(p_reparto_ids, array[]::uuid[])) as requested(reparto_id)
    where requested.reparto_id is not null
  ) richiesti;

  if reparti_richiesti = 0 then
    raise exception 'Seleziona almeno un reparto';
  end if;

  select count(*) into reparti_trovati
  from public.reparti r
  where r.id in (
    select distinct requested.reparto_id
    from unnest(p_reparto_ids) as requested(reparto_id)
    where requested.reparto_id is not null
  )
    and r.attivo is true;

  if reparti_trovati <> reparti_richiesti then
    raise exception 'Uno o piu reparti selezionati non sono validi';
  end if;

  insert into public.chat_conversazioni (titolo, tipo, created_by)
  values (btrim(p_titolo), 'gruppo', profilo_id)
  returning id into nuova_conversazione_id;

  insert into public.chat_partecipanti (conversazione_id, utente_id)
  select nuova_conversazione_id, membri.utente_id
  from (
    select profilo_id as utente_id
    union
    select u.id
    from public.utenti u
    where u.attivo is not false
      and (
        u.reparto_id = any(p_reparto_ids)
        or exists (
          select 1
          from public.utenti_reparti ur
          where ur.utente_id = u.id
            and ur.reparto_id = any(p_reparto_ids)
        )
      )
  ) membri
  on conflict (conversazione_id, utente_id) do nothing;

  return nuova_conversazione_id;
end;
$$;

revoke all on function public.chat_create_department_group(text, uuid[])
  from public, anon;
grant execute on function public.chat_create_department_group(text, uuid[])
  to authenticated, service_role;

commit;

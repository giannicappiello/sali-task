begin;

create or replace function public.registra_dispositivo_notifiche(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_nome_dispositivo text,
  p_user_agent text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  profilo_id uuid;
  dispositivo_id uuid;
begin
  select id into profilo_id
  from public.utenti
  where auth_user_id = auth.uid()
    and attivo = true;

  if profilo_id is null then
    raise exception 'Profilo Workspace non valido';
  end if;

  insert into public.notifiche_dispositivi(
    utente_id, endpoint, p256dh, auth, nome_dispositivo, user_agent, attivo, ultimo_utilizzo
  )
  values (
    profilo_id, p_endpoint, p_p256dh, p_auth, p_nome_dispositivo, p_user_agent, true, now()
  )
  on conflict (endpoint) do update
  set utente_id = excluded.utente_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      nome_dispositivo = excluded.nome_dispositivo,
      user_agent = excluded.user_agent,
      attivo = true,
      ultimo_utilizzo = now()
  returning id into dispositivo_id;

  insert into public.notifiche_preferenze(utente_id, push_attive, suono_attivo, updated_at)
  values (profilo_id, true, true, now())
  on conflict (utente_id) do update
  set push_attive = true,
      updated_at = now();

  return dispositivo_id;
end;
$$;

grant execute on function public.registra_dispositivo_notifiche(text, text, text, text, text) to authenticated;

create or replace function public.chat_elimina_conversazione(
  p_conversazione_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  profilo_id uuid;
  autorizzato boolean;
begin
  select id into profilo_id
  from public.utenti
  where auth_user_id = auth.uid();

  select exists (
    select 1
    from public.chat_partecipanti
    where conversazione_id = p_conversazione_id
      and utente_id = profilo_id
  ) or exists (
    select 1
    from public.utenti u
    join public.ruoli r on r.id = u.ruolo_id
    where u.id = profilo_id
      and (coalesce(r.livello, 0) >= 80 or lower(r.nome) in ('admin','administrator','amministratore','super admin','direzione'))
  ) into autorizzato;

  if profilo_id is null or not coalesce(autorizzato, false) then
    raise exception 'Conversazione non autorizzata';
  end if;

  delete from public.notifiche
  where chat_conversazione_id = p_conversazione_id;
  delete from public.chat_allegati
  where conversazione_id = p_conversazione_id;
  delete from public.chat_messaggi
  where conversazione_id = p_conversazione_id;
  delete from public.chat_partecipanti
  where conversazione_id = p_conversazione_id;
  delete from public.chat_conversazioni
  where id = p_conversazione_id;
end;
$$;

grant execute on function public.chat_elimina_conversazione(uuid) to authenticated;

do $$
declare
  tabella text;
begin
  foreach tabella in array array['notifiche', 'chat_conversazioni', 'chat_messaggi', 'chat_partecipanti']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = tabella
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tabella);
    end if;
  end loop;
end;
$$;

commit;

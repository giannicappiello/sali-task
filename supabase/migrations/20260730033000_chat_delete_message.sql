begin;

create or replace function public.chat_elimina_messaggio(p_messaggio_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  profilo_id uuid;
  conversazione_id uuid;
  mittente_id uuid;
  amministratore boolean;
begin
  select id into profilo_id from public.utenti where auth_user_id = auth.uid();
  select m.conversazione_id, m.mittente_id into conversazione_id, mittente_id
  from public.chat_messaggi m where m.id = p_messaggio_id;

  select exists (
    select 1 from public.utenti u
    join public.ruoli r on r.id = u.ruolo_id
    where u.id = profilo_id
      and (coalesce(r.livello, 0) >= 80 or lower(r.nome) in ('admin','administrator','amministratore','super admin','direzione'))
  ) into amministratore;

  if profilo_id is null or conversazione_id is null
     or (mittente_id <> profilo_id and not coalesce(amministratore, false)) then
    raise exception 'Messaggio non autorizzato';
  end if;

  delete from public.chat_allegati where messaggio_id = p_messaggio_id;
  delete from public.chat_messaggi where id = p_messaggio_id;

  update public.chat_conversazioni
  set updated_at = coalesce(
    (select max(created_at) from public.chat_messaggi where conversazione_id = chat_conversazioni.id),
    created_at
  )
  where id = conversazione_id;

  return conversazione_id;
end;
$$;

grant execute on function public.chat_elimina_messaggio(uuid) to authenticated;

commit;

begin;

create or replace function public.chat_clear_read_notifications(
  p_conversazione_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  profilo_id uuid;
  eliminate integer;
begin
  select id into profilo_id
  from public.utenti
  where auth_user_id = auth.uid();

  if profilo_id is null or not exists (
    select 1
    from public.chat_partecipanti
    where conversazione_id = p_conversazione_id
      and utente_id = profilo_id
  ) then
    raise exception 'Conversazione non autorizzata';
  end if;

  delete from public.notifiche
  where utente_id = profilo_id
    and chat_conversazione_id = p_conversazione_id;
  get diagnostics eliminate = row_count;
  return eliminate;
end;
$$;

grant execute on function public.chat_clear_read_notifications(uuid) to authenticated;

create or replace function public.rimuovi_notifiche_chat_lette()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ultimo_letto_il is distinct from old.ultimo_letto_il
     and new.ultimo_letto_il is not null then
    delete from public.notifiche
    where utente_id = new.utente_id
      and chat_conversazione_id = new.conversazione_id;
  end if;
  return new;
end;
$$;

commit;

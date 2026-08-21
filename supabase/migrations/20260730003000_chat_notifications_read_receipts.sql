begin;

alter table public.notifiche_preferenze
  alter column push_attive set default true;

update public.notifiche_preferenze
set push_attive = true,
    suono_attivo = true,
    updated_at = now()
where push_attive = false;

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
      and chat_conversazione_id = new.conversazione_id
      and (
        evento = 'messaggio_nuovo'
        or tipo = 'chat'
      );
  end if;
  return new;
end;
$$;

drop trigger if exists chat_partecipanti_pulisci_notifiche on public.chat_partecipanti;
create trigger chat_partecipanti_pulisci_notifiche
after update of ultimo_letto_il on public.chat_partecipanti
for each row execute function public.rimuovi_notifiche_chat_lette();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_partecipanti'
  ) then
    alter publication supabase_realtime add table public.chat_partecipanti;
  end if;
end;
$$;

commit;

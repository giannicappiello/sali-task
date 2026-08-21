begin;

create or replace function public.genera_notifiche_scadenze()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  created_count integer := 0;
  lead_minutes integer;
  inserted_count integer;
begin
  for lead_minutes in
    select unnest(anticipo_minuti)
    from public.notifiche_regole
    where codice = 'attivita_scadenza' and attiva = true
  loop
    insert into public.notifiche (
      utente_id, titolo, messaggio, tipo, evento, task_id, url, priorita, metadata
    )
    select
      t.assegnato_a_id,
      'Attività in scadenza',
      coalesce(t.titolo, 'Attività') ||
        case when lead_minutes >= 1440 then ' scade entro ' || (lead_minutes / 1440) || ' giorno/i.'
             else ' scade entro ' || lead_minutes || ' minuti.' end,
      'scadenza',
      'attivita_scadenza',
      t.id,
      '/activities/tasks?task=' || t.id::text,
      case when lead_minutes <= 60 then 'alta' else 'normale' end,
      jsonb_build_object('anticipo_minuti', lead_minutes, 'deadline', t.deadline)
    from public.tasks t
    where t.assegnato_a_id is not null
      and t.deadline is not null
      and t.deadline::timestamptz > now()
      and t.deadline::timestamptz <= now() + make_interval(mins => lead_minutes)
      and not exists (
        select 1 from public.notifiche n
        where n.utente_id = t.assegnato_a_id
          and n.task_id = t.id
          and n.evento = 'attivita_scadenza'
          and n.metadata ->> 'anticipo_minuti' = lead_minutes::text
          and n.created_at > now() - interval '7 days'
      );
    get diagnostics inserted_count = row_count;
    created_count := created_count + inserted_count;
  end loop;
  return created_count;
end;
$$;

revoke all on function public.genera_notifiche_scadenze() from public, anon, authenticated;
grant execute on function public.genera_notifiche_scadenze() to service_role;

commit;

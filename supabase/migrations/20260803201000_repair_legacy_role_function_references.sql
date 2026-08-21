begin;

-- Alcune funzioni SQL storiche non creano una dipendenza catalogata sulla colonna
-- e sono quindi sopravvissute alla rimozione di ruoli.livello. Le ricompiliamo
-- conservando la precedente semantica amministrativa (100/0) tramite il nuovo flag.
do $$
declare
  routine record;
  old_definition text;
  new_definition text;
begin
  for routine in
    select p.oid, n.nspname, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ~* 'r\.livello([^_a-zA-Z0-9]|$)'
  loop
    old_definition := pg_get_functiondef(routine.oid);
    new_definition := regexp_replace(
      old_definition,
      'r\.livello([^_a-zA-Z0-9]|$)',
      '(case when coalesce(r.amministratore_workspace, false) then 100 else 0 end)\1',
      'gi'
    );
    execute new_definition;
  end loop;
end $$;

-- Controllo bloccante: nessuna funzione pubblica deve continuare a interrogare
-- la colonna numerica rimossa. Evita che l'errore possa riapparire silenziosamente.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ~* 'r\.livello([^_a-zA-Z0-9]|$)'
  ) then
    raise exception 'Sono rimasti riferimenti a ruoli.livello nelle funzioni pubbliche';
  end if;
end $$;

commit;

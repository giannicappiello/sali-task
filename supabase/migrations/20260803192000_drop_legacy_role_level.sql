do $$
declare
  view_definition text;
  view_owner text;
begin
  view_definition := pg_get_viewdef('public.vw_integrazioni_utenti'::regclass, true);
  select pg_get_userbyid(c.relowner)
    into view_owner
  from pg_class c
  where c.oid = 'public.vw_integrazioni_utenti'::regclass;

  view_definition := replace(view_definition, 'r.livello', 'r.amministratore_workspace');
  view_definition := replace(view_definition, 'ruolo_livello', 'ruolo_amministratore_workspace');
  view_definition := regexp_replace(view_definition, 'as\s+livello([,[:space:]])', 'as amministratore_workspace\1', 'gi');
  if view_definition ilike '%livello%' then
    raise exception 'La vista contiene ancora riferimenti al livello numerico';
  end if;

  execute 'drop view public.vw_integrazioni_utenti';
  execute 'create view public.vw_integrazioni_utenti with (security_invoker=true) as ' || view_definition;
  execute format('alter view public.vw_integrazioni_utenti owner to %I', view_owner);
  grant select on public.vw_integrazioni_utenti to authenticated, service_role;
end $$;

alter table public.ruoli drop column livello restrict;

begin;

-- This is the same effective screen decision used by the Workspace UI.
create or replace function public.workspace_progremes_screen_levels_for_user(target_user_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_object_agg(s.codice,public.workspace_screen_level_for_user(target_user_id,s.codice)),'{}'::jsonb)
  from public.workspace_schermate s where s.provider='progremes' and s.attiva;
$$;
revoke all on function public.workspace_progremes_screen_levels_for_user(uuid) from public,anon,authenticated;
grant execute on function public.workspace_progremes_screen_levels_for_user(uuid) to service_role;

create or replace function public.consume_progremes_sso_ticket(target_token_hash text)
returns table (
  workspace_user_id uuid,email text,nome text,cognome text,amministratore boolean,moduli text[],ai_allowed boolean,
  schermata_codice text,percorso_destinazione text
)
language plpgsql security definer set search_path=public as $$
begin
  return query
  with consumed as (
    update public.progremes_sso_tickets ticket set consumato_il=now()
    where ticket.token_hash=target_token_hash and ticket.consumato_il is null and ticket.scade_il>=now()
    returning ticket.utente_id,ticket.schermata_codice,ticket.percorso_destinazione
  ), profile as (
    select u.*,coalesce(r.amministratore_workspace,false) is_admin,coalesce(r.livello_ai,'nessuno') role_ai_level,
      c.schermata_codice requested_screen,c.percorso_destinazione requested_path
    from consumed c join public.utenti u on u.id=c.utente_id left join public.ruoli r on r.id=u.ruolo_id where u.attivo is not false
  )
  select p.id,lower(btrim(p.email)),coalesce(p.nome,''),coalesce(p.cognome,''),p.is_admin,
    coalesce((select array_agg(distinct coalesce(nullif(s.metadati->>'external_module_code',''),
      split_part(coalesce(s.metadati->>'external_code',replace(s.codice,'progremes.','')),'.',1)))
      from public.workspace_schermate s where s.provider='progremes' and s.attiva
        and public.workspace_screen_level_for_user(p.id,s.codice) in ('lettura','scrittura','amministrazione')),array[]::text[]),
    (p.is_admin or (p.role_ai_level<>'nessuno' and public.workspace_module_enabled_for_user(p.id,'assistente_ai'))),
    p.requested_screen,p.requested_path
  from profile p where nullif(btrim(coalesce(p.email,'')),'') is not null;
end $$;
revoke all on function public.consume_progremes_sso_ticket(text) from public,anon,authenticated;
grant execute on function public.consume_progremes_sso_ticket(text) to service_role;
commit;

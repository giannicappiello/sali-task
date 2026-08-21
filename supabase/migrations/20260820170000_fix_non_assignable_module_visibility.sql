begin;

-- "Non assegnabile ai reparti" descrive il metodo di configurazione del
-- modulo, non costituisce un'autorizzazione implicita. In particolare:
--   * i moduli ProgreMES ereditano le assegnazioni ProgreMES del reparto;
--   * le viste derivate ereditano l'accesso dai moduli da cui dipendono;
--   * gli altri moduli non assegnabili richiedono un'eccezione personale;
--   * l'Admin continua ad avere accesso completo.
create or replace function public.workspace_module_enabled_for_user(
  target_user_id uuid,
  target_module text
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  with target as (
    select
      u.id,
      u.ruolo_id,
      u.reparto_id,
      u.auth_user_id,
      coalesce(r.amministratore_workspace,false) as is_admin
    from public.utenti u
    left join public.ruoli r on r.id=u.ruolo_id
    where u.id=target_user_id
      and u.attivo is not false
    limit 1
  ), personal_exception as (
    select e.decisione
    from target t
    join public.workspace_eccezioni_utente e on e.utente_id=t.id
    where e.ambito='modulo'
      and e.codice=target_module
      and (e.valida_fino_a is null or e.valida_fino_a>now())
    order by e.aggiornata_il desc nulls last
    limit 1
  ), departments as (
    select ur.reparto_id
    from public.utenti_reparti ur
    join target t on t.id=ur.utente_id
    where ur.reparto_id is not null
    union
    select t.reparto_id
    from target t
    where t.reparto_id is not null
  )
  select coalesce((
    select case
      when t.is_admin then true
      when (select decisione from personal_exception)='consenti' then true
      when (select decisione from personal_exception)='nega' then false
      when m.attivo is false then false
      when m.area is not null
        and not (m.area=any(public.workspace_area_access_codes(t.auth_user_id)))
        then false
      when m.sempre_disponibile then true

      -- Il contenitore principale ProgreMES usa l'assegnazione Workspace.
      when m.assegnabile_reparto then exists (
        select 1
        from departments d
        join public.reparti_moduli rm on rm.reparto_id=d.reparto_id
        where rm.modulo=target_module
      )

      -- I moduli sincronizzati da ProgreMES non sono assegnabili dal catalogo
      -- Workspace: la loro autorizzazione vive in progremes_reparti_moduli.
      when m.provider='progremes' and target_module<>'progremes' then
        exists (
          select 1
          from departments d
          join public.reparti_moduli master_access
            on master_access.reparto_id=d.reparto_id
           and master_access.modulo='progremes'
          join public.progremes_reparti_moduli prm
            on prm.reparto_id=d.reparto_id
          join public.progremes_moduli pm
            on pm.codice=prm.modulo_codice
           and pm.attivo is true
          where public.workspace_progremes_module_code(prm.modulo_codice)=target_module
        )

      -- Una vista derivata è visibile soltanto se sono accessibili tutti i
      -- moduli dichiarati come dipendenza.
      when cardinality(coalesce(m.dipendenze,'{}'::text[]))>0 then
        not exists (
          select 1
          from unnest(m.dipendenze) dependency(module_code)
          where not public.workspace_module_enabled_for_user(
            target_user_id,
            dependency.module_code
          )
        )

      -- Un modulo non assegnabile, non pubblico e senza dipendenze non deve
      -- apparire per effetto del solo ruolo o dell'Area. Per un non Admin può
      -- essere aperto mediante un'eccezione personale "consenti" (gestita sopra).
      else false
    end
    from target t
    join public.workspace_moduli m on m.codice=target_module
  ),false)
$$;

revoke all on function public.workspace_module_enabled_for_user(uuid,text)
  from public,anon;
grant execute on function public.workspace_module_enabled_for_user(uuid,text)
  to authenticated,service_role;

commit;

-- Multiple independent areas per module. Existing assignments are retained.
-- "area" remains a compatibility mirror, never a second authorization source.
alter table public.workspace_moduli add column aree text[] not null default '{}';
update public.workspace_moduli set aree=array[coalesce(area,'workspace')];
alter table public.workspace_moduli add constraint workspace_module_areas_nonempty check(cardinality(aree)>0);

-- FK-backed mirror: an area in ANY position cannot be deleted while in use.
create table public.workspace_moduli_aree (
  modulo_codice text not null references public.workspace_moduli(codice) on update cascade on delete cascade,
  area_codice text not null references public.workspace_aree(codice) on update restrict on delete restrict,
  primary key(modulo_codice,area_codice)
);
alter table public.workspace_moduli_aree enable row level security;
revoke all on public.workspace_moduli_aree from public,anon,authenticated;
grant select on public.workspace_moduli_aree to authenticated;
grant all on public.workspace_moduli_aree to service_role;
create policy "active users read module area links" on public.workspace_moduli_aree
for select to authenticated using ((select public.workspace_current_profile_id()) is not null);
insert into public.workspace_moduli_aree select s.codice,a from public.workspace_moduli s cross join unnest(s.aree) a;

create or replace function public.workspace_normalize_module_areas()
returns trigger language plpgsql set search_path=public as $fn$
begin
  if tg_op='INSERT' and cardinality(coalesce(new.aree,'{}'))=0 then
    new.aree=array[coalesce(new.area,'workspace')];
  end if;
  -- Catalog resynchronization or old clients must not restore a removed area.
  if tg_op='UPDATE' and new.aree is not distinct from old.aree then new.aree=old.aree; end if;
  select coalesce(array_agg(code order by first_position),'{}') into new.aree
  from (select lower(btrim(value)) code,min(position) first_position
        from unnest(new.aree) with ordinality a(value,position)
        where nullif(btrim(value),'') is not null group by lower(btrim(value))) normalized;
  if cardinality(new.aree)=0 then raise exception 'Seleziona almeno un’area per il modulo.' using errcode='23514'; end if;
  new.area=new.aree[1];
  return new;
end $fn$;
create trigger zz_workspace_normalize_module_areas before insert or update on public.workspace_moduli
for each row execute function public.workspace_normalize_module_areas();

create or replace function public.workspace_sync_module_area_links()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  delete from public.workspace_moduli_aree where modulo_codice=new.codice and not(area_codice=any(new.aree));
  insert into public.workspace_moduli_aree select new.codice,a from unnest(new.aree) a on conflict do nothing;
  return null;
end $fn$;
create trigger workspace_sync_module_area_links after insert or update of aree on public.workspace_moduli
for each row execute function public.workspace_sync_module_area_links();
revoke all on function public.workspace_normalize_module_areas(), public.workspace_sync_module_area_links() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_workspace_module(target_module jsonb, target_screen_codes text[], target_default_screen text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_code text := lower(btrim(coalesce(target_module->>'codice','')));
  normalized_screen_codes text[] := coalesce(target_screen_codes,array[]::text[]);
  target_path text := nullif(btrim(target_module->>'percorso'),'');
  target_type text := coalesce(nullif(target_module->>'tipo',''),'modulo');
  target_icon text := lower(btrim(coalesce(target_module->>'icona','blocks')));
  existing_protected boolean := false;
  existing_type text;
  existing_path text;
  dedicated_container boolean := false;
  existing_area text;
  existing_areas text[];
  selected_areas text[];
begin
  if not public.workspace_user_is_admin() then raise exception 'Operazione riservata all''amministratore Workspace.' using errcode='42501'; end if;
  if target_code !~ '^[a-z0-9_]+$' or btrim(coalesce(target_module->>'nome',''))='' then raise exception 'Codice o nome modulo non valido.'; end if;
  if target_icon !~ '^[a-z0-9-]+$' then target_icon := 'blocks'; end if;

  select protetto,tipo,percorso,area,aree into existing_protected,existing_type,existing_path,existing_area,existing_areas
  from public.workspace_moduli where codice=target_code for update;

  if target_module ? 'aree' then
    if jsonb_typeof(target_module->'aree') is distinct from 'array' then raise exception 'Elenco aree non valido.'; end if;
    select array_agg(value) into selected_areas from jsonb_array_elements_text(target_module->'aree');
  elsif target_module ? 'area' and target_module->>'area' is distinct from existing_area then
    selected_areas=array[target_module->>'area'];
  else selected_areas=coalesce(existing_areas,array['workspace']);
  end if;
  select coalesce(array_agg(code order by first_position),'{}') into selected_areas
    from (select lower(btrim(value)) code,min(position) first_position
      from unnest(selected_areas) with ordinality a(value,position)
      where nullif(btrim(value),'') is not null group by lower(btrim(value))) normalized;
  if cardinality(selected_areas)=0 then raise exception 'Seleziona almeno un’area per il modulo.'; end if;
  if exists(select 1 from unnest(selected_areas) a where not exists(select 1 from public.workspace_aree where codice=a)) then raise exception 'Area non valida.'; end if;


  dedicated_container := coalesce(existing_type='contenitore' and existing_path is not null and existing_path not like '/moduli/%',false);

  if target_default_screen is not null and target_default_screen=any(normalized_screen_codes) then
    select percorso into target_path
    from public.workspace_schermate
    where codice=target_default_screen and attiva;
    if target_path is null then raise exception 'Schermata iniziale non disponibile.'; end if;
  else
    target_default_screen := null;
    target_type := 'contenitore';
    target_path := case
      when dedicated_container then existing_path
      else '/moduli/' || target_code
    end;
  end if;

  if dedicated_container then
    target_type := 'contenitore';
    target_path := existing_path;
  end if;

  insert into public.workspace_moduli
    (codice,nome,descrizione,tipo,area,aree,percorso,provider,sempre_disponibile,assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,icona,aggiornato_il)
  values
    (target_code,btrim(target_module->>'nome'),nullif(btrim(target_module->>'descrizione'),''),target_type,selected_areas[1],selected_areas,target_path,coalesce(nullif(target_module->>'provider',''),'workspace'),coalesce((target_module->>'sempre_disponibile')::boolean,false),coalesce((target_module->>'assegnabile_reparto')::boolean,false),coalesce((target_module->>'configurabile_ruolo')::boolean,true),coalesce((target_module->>'mostra_menu')::boolean,true),coalesce((target_module->>'attivo')::boolean,true),coalesce((target_module->>'ordine')::integer,0),target_icon,now())
  on conflict (codice) do update set
    nome=excluded.nome,
    descrizione=excluded.descrizione,
    tipo=case when workspace_moduli.protetto then workspace_moduli.tipo else excluded.tipo end,
    area=excluded.area,
    aree=excluded.aree,
    percorso=case when workspace_moduli.protetto and workspace_moduli.tipo='contenitore' then workspace_moduli.percorso else excluded.percorso end,
    provider=case when workspace_moduli.protetto then workspace_moduli.provider else excluded.provider end,
    sempre_disponibile=case when workspace_moduli.protetto then true else excluded.sempre_disponibile end,
    assegnabile_reparto=case when workspace_moduli.protetto then false else excluded.assegnabile_reparto end,
    configurabile_ruolo=excluded.configurabile_ruolo,
    mostra_menu=excluded.mostra_menu,
    attivo=case when workspace_moduli.protetto then true else excluded.attivo end,
    ordine=excluded.ordine,
    icona=excluded.icona,
    aggiornato_il=now();

  delete from public.workspace_moduli_schermate
  where modulo_codice=target_code and not (schermata_codice=any(normalized_screen_codes));

  insert into public.workspace_moduli_schermate (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
  select target_code,code,ordinality::integer*10,coalesce(code=target_default_screen,false),true
  from unnest(normalized_screen_codes) with ordinality as selected(code,ordinality)
  join public.workspace_schermate screen on screen.codice=selected.code and screen.attiva
  on conflict (modulo_codice,schermata_codice) do update set
    ordine=excluded.ordine,predefinita=excluded.predefinita,visibile_menu=true;
end $function$;

CREATE OR REPLACE FUNCTION public.workspace_module_enabled_for_user(target_user_id uuid, target_module text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 with target as (
  select u.id,u.ruolo_id,u.reparto_id,u.auth_user_id,coalesce(r.amministratore_workspace,false) is_admin,
    coalesce(r.livello_ai,'analisi') role_ai_level
  from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
  where u.id=target_user_id and u.attivo is not false limit 1
 ), exception as (
  select e.decisione from target t join public.workspace_eccezioni_utente e on e.utente_id=t.id
  where e.ambito='modulo' and e.codice=target_module and (e.valida_fino_a is null or e.valida_fino_a>now()) limit 1
 ), departments as (
  select ur.reparto_id from public.utenti_reparti ur join target t on t.id=ur.utente_id where ur.reparto_id is not null
  union select t.reparto_id from target t where t.reparto_id is not null
 )
 select coalesce((select case
  when t.is_admin then true
  -- Online submodules cannot reopen an excluded Online channel.
  when target_module in ('crm_online_ecommerce','crm_online_mailing','crm_online_amazon','crm_online_adv')
    and not public.workspace_module_enabled_for_user(target_user_id,'crm_online') then false
  when target_module in ('assistente_ai','crm_ai') and t.role_ai_level='nessuno' then false
  when (select decisione from exception)='consenti' then true
  when (select decisione from exception)='nega' then false
  when not m.attivo then false
  when not (m.aree && public.workspace_area_access_codes(t.auth_user_id)) then false
  -- A role sets the operational level; it never grants a DIRECT channel.
  when target_module in ('crm_brand_direct','crm_b2b','crm_online') then exists(
    select 1 from departments d join public.reparti_moduli rm on rm.reparto_id=d.reparto_id
    where rm.modulo=target_module)
  when m.sempre_disponibile then true
  when cardinality(coalesce(m.dipendenze_alternative,'{}'))>0 then exists(
    select 1 from unnest(m.dipendenze_alternative) d(code)
    where public.workspace_module_enabled_for_user(target_user_id,d.code))
  when m.assegnabile_reparto then exists(select 1 from departments d join public.reparti_moduli rm on rm.reparto_id=d.reparto_id where rm.modulo=target_module)
  when m.provider='progremes' and target_module<>'progremes' then exists(
    select 1 from departments d join public.reparti_moduli ma on ma.reparto_id=d.reparto_id and ma.modulo='progremes'
    join public.progremes_reparti_moduli prm on prm.reparto_id=d.reparto_id
    join public.progremes_moduli pm on pm.codice=prm.modulo_codice and pm.attivo
    where public.workspace_progremes_module_code(prm.modulo_codice)=target_module)
  when cardinality(coalesce(m.dipendenze,'{}'))>0 then not exists(
    select 1 from unnest(m.dipendenze) d(code) where not public.workspace_module_enabled_for_user(target_user_id,d.code))
  else false end from target t join public.workspace_moduli m on m.codice=target_module),false)
$function$;

CREATE OR REPLACE FUNCTION public.workspace_inspect_module_access(target_user_id uuid)
 RETURNS TABLE(codice text, allowed boolean, level text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not coalesce(public.workspace_user_is_admin(),false) then
    raise exception 'Operazione riservata all''amministratore Workspace.' using errcode='42501';
  end if;
  return query
  select m.codice, a.enabled,
    case when not a.enabled then 'nessuno'
      when coalesce(r.amministratore_workspace,false) then 'amministrazione'
      else coalesce(e.livello_accesso,rm.livello_accesso,r.livello_accesso,'lettura') end,
    case when u.attivo is false then 'Utente disattivato'
      when coalesce(r.amministratore_workspace,false) then 'Accesso completo amministratore'
      when m.codice in ('crm_online_ecommerce','crm_online_mailing','crm_online_amazon','crm_online_adv')
        and not public.workspace_module_enabled_for_user(u.id,'crm_online')
        then 'Canale CRM Online non autorizzato'
      when e.decisione is not null then 'Eccezione personale: ' || e.decisione
      when not m.attivo then 'Modulo disattivato'
      when not (m.aree && public.workspace_area_access_codes(u.auth_user_id))
        then 'Nessuna area del modulo autorizzata: ' || array_to_string(m.aree,', ')
      when a.enabled and cardinality(coalesce(m.dipendenze_alternative,'{}'))>0
        then 'Contenitore visibile tramite i moduli autorizzati'
      when a.enabled and m.sempre_disponibile then 'Modulo sempre disponibile'
      when a.enabled then 'Modulo autorizzato; operatività dal ruolo; aree: ' ||
        (select string_agg(code,', ' order by code) from unnest(m.aree) code where code=any(public.workspace_area_access_codes(u.auth_user_id)))
      else 'Modulo non autorizzato dalle regole effettive' end
  from public.utenti u
  left join public.ruoli r on r.id=u.ruolo_id
  cross join public.workspace_moduli m
  left join public.ruoli_moduli rm on rm.ruolo_id=u.ruolo_id and rm.modulo=m.codice
  left join public.workspace_eccezioni_utente e on e.utente_id=u.id and e.ambito='modulo'
    and e.codice=m.codice and (e.valida_fino_a is null or e.valida_fino_a>now())
  cross join lateral (select public.workspace_module_enabled_for_user(u.id,m.codice) as enabled) a
  where u.id=target_user_id
  order by m.ordine,m.codice;
end;
$function$;

CREATE OR REPLACE FUNCTION public.workspace_session_access()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 select jsonb_build_object(
   'revision',(select revision from workspace_access_revision where id),
   'profile',(select jsonb_build_object('id',u.id,'auth_user_id',u.auth_user_id,'nome',u.nome,'cognome',u.cognome,
     'email',u.email,'telefono',u.telefono,'avatar_url',u.avatar_url,'attivo',u.attivo,'ultimo_accesso',u.ultimo_accesso,
     'last_seen',u.last_seen,'ruolo_id',u.ruolo_id,'reparto_id',u.reparto_id,'reparti',
     (select jsonb_build_object('id',r.id,'nome',r.nome) from reparti r where r.id=u.reparto_id))
     from utenti u where u.auth_user_id=auth.uid() and u.attivo is not false limit 1),
   'access',workspace_access_context(),'scope',workspace_data_scope(),'areas',workspace_area_access_codes(),
   'module_area_codes',coalesce((select jsonb_object_agg(codice,aree) from workspace_moduli),'{}'::jsonb),
   'module_areas',coalesce((select jsonb_object_agg(codice,area) from workspace_moduli),'{}'::jsonb),
   'screens',coalesce((select jsonb_agg(jsonb_build_object('codice',s.codice,'percorso',s.percorso,'attiva',s.attiva,
     'area',s.area,'aree',s.aree,'metadati',s.metadati)) from workspace_schermate s where s.attiva),'[]'::jsonb),
   'screen_levels',coalesce((select jsonb_object_agg(s.codice,workspace_screen_level_for_user(workspace_current_profile_id(),s.codice))
     from workspace_schermate s where s.attiva),'{}'::jsonb),
   'links',coalesce((select jsonb_agg(to_jsonb(l) order by l.ordine) from workspace_moduli_schermate l),'[]'::jsonb),
   'departments',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'nome',r.nome)) from reparti r
     where r.id in(select reparto_id from utenti_reparti where utente_id=workspace_current_profile_id()
       union select reparto_id from utenti where id=workspace_current_profile_id())),'[]'::jsonb)
 )
$function$;

notify pgrst,'reload schema';

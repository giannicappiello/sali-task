-- Multiple independent areas per screen. Existing assignments are retained.
-- "area" remains a compatibility mirror, never a second authorization source.
alter table public.workspace_schermate add column aree text[] not null default '{}';
update public.workspace_schermate set aree=array[coalesce(area,'workspace')];
alter table public.workspace_schermate add constraint workspace_screen_areas_nonempty check(cardinality(aree)>0);

-- FK-backed mirror: an area in ANY position cannot be deleted while in use.
create table public.workspace_schermate_aree (
  schermata_codice text not null references public.workspace_schermate(codice) on update cascade on delete cascade,
  area_codice text not null references public.workspace_aree(codice) on update restrict on delete restrict,
  primary key(schermata_codice,area_codice)
);
alter table public.workspace_schermate_aree enable row level security;
revoke all on public.workspace_schermate_aree from public,anon,authenticated;
grant select on public.workspace_schermate_aree to authenticated;
grant all on public.workspace_schermate_aree to service_role;
create policy "active users read screen area links" on public.workspace_schermate_aree
for select to authenticated using ((select public.workspace_current_profile_id()) is not null);
insert into public.workspace_schermate_aree select s.codice,a from public.workspace_schermate s cross join unnest(s.aree) a;

create or replace function public.workspace_normalize_screen_areas()
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
  if cardinality(new.aree)=0 then raise exception 'Seleziona almeno un’area per la schermata.' using errcode='23514'; end if;
  new.area=new.aree[1];
  return new;
end $fn$;
create trigger zz_workspace_normalize_screen_areas before insert or update on public.workspace_schermate
for each row execute function public.workspace_normalize_screen_areas();

create or replace function public.workspace_sync_screen_area_links()
returns trigger language plpgsql security definer set search_path=public as $fn$
begin
  delete from public.workspace_schermate_aree where schermata_codice=new.codice and not(area_codice=any(new.aree));
  insert into public.workspace_schermate_aree select new.codice,a from unnest(new.aree) a on conflict do nothing;
  return null;
end $fn$;
create trigger workspace_sync_screen_area_links after insert or update of aree on public.workspace_schermate
for each row execute function public.workspace_sync_screen_area_links();
revoke all on function public.workspace_normalize_screen_areas(), public.workspace_sync_screen_area_links() from public,anon,authenticated;

create or replace function public.admin_update_workspace_screen(target_screen jsonb)
returns void language plpgsql security definer set search_path=public as $fn$
declare current_screen public.workspace_schermate%rowtype; selected_areas text[];
begin
  if not public.workspace_user_is_admin() then raise exception 'Operazione riservata all''amministratore Workspace.' using errcode='42501'; end if;
  select * into current_screen from public.workspace_schermate where codice=target_screen->>'codice' for update;
  if not found then raise exception 'Schermata non trovata.'; end if;
  if target_screen ? 'aree' then
    if jsonb_typeof(target_screen->'aree') is distinct from 'array' then raise exception 'Elenco aree non valido.'; end if;
    select array_agg(value) into selected_areas from jsonb_array_elements_text(target_screen->'aree');
  elsif target_screen ? 'area' and target_screen->>'area' is distinct from current_screen.area then
    selected_areas=array[target_screen->>'area'];
  else selected_areas=current_screen.aree;
  end if;
  select coalesce(array_agg(code order by first_position),'{}') into selected_areas
    from (select lower(btrim(value)) code,min(position) first_position
      from unnest(selected_areas) with ordinality a(value,position)
      where nullif(btrim(value),'') is not null group by lower(btrim(value))) normalized;
  if cardinality(selected_areas)=0 then raise exception 'Seleziona almeno un’area per la schermata.'; end if;
  if exists(select 1 from unnest(selected_areas) a where not exists(select 1 from public.workspace_aree where codice=a)) then raise exception 'Area non valida.'; end if;
  update public.workspace_schermate set
    nome=btrim(target_screen->>'nome'), descrizione=nullif(btrim(target_screen->>'descrizione'),''),
    aree=selected_areas, area=selected_areas[1],
    icona=coalesce(nullif(btrim(target_screen->>'icona'),''),'blocks'),
    attiva=case when protetta then true else coalesce((target_screen->>'attiva')::boolean,true) end,
    ordine=coalesce((target_screen->>'ordine')::integer,ordine)
  where codice=current_screen.codice;
end $fn$;
CREATE OR REPLACE FUNCTION public.workspace_screen_level_for_user(target_user_id uuid, target_screen text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 with target as (
   select u.id,u.auth_user_id,u.ruolo_id,r.livello_accesso,
     coalesce(r.amministratore_workspace,false) is_admin
   from utenti u left join ruoli r on r.id=u.ruolo_id
   where u.id=target_user_id and u.attivo is not false
 ), exception as (
   select e.decisione,e.livello_accesso from workspace_eccezioni_utente e
   where e.utente_id=target_user_id and e.ambito='schermata' and e.codice=target_screen
     and (e.valida_fino_a is null or e.valida_fino_a>now())
 ), linked as (
   select m.codice,coalesce(rm.livello_accesso,t.livello_accesso,'lettura') level
   from target t join workspace_moduli_schermate l on l.schermata_codice=target_screen
   join workspace_moduli m on m.codice=l.modulo_codice
   left join ruoli_moduli rm on rm.ruolo_id=t.ruolo_id and rm.modulo=m.codice
 )
 select coalesce((select case
   when not s.attiva then 'nessuno'
   when t.is_admin then 'amministrazione'
   when s.metadati->>'admin_only'='true' then 'nessuno'
   when (select decisione from exception)='nega' then 'nessuno'
   when (select decisione from exception)='consenti'
     or s.aree && workspace_area_access_codes(t.auth_user_id)
     or exists(select 1 from linked l where workspace_module_enabled_for_user(t.id,l.codice))
   then coalesce((select livello_accesso from exception where decisione='consenti'),
     (select l.level from linked l order by case l.level when 'amministrazione' then 3 when 'scrittura' then 2 when 'lettura' then 1 else 0 end desc limit 1),
     t.livello_accesso,'lettura')
   else 'nessuno' end from target t join workspace_schermate s on s.codice=target_screen),'nessuno')
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

create or replace function public.workspace_inspect_screen_access(target_user_id uuid)
returns table(codice text,allowed boolean,level text,reason text)
language plpgsql stable security definer set search_path=public as $fn$
begin
 if not workspace_user_is_admin() then raise exception 'Operazione riservata agli amministratori' using errcode='42501'; end if;
 return query select s.codice,a.level<>'nessuno',a.level,
   case when u.attivo is false then 'Utente disattivato'
   when not s.attiva then 'Schermata disattivata'
   when workspace_user_is_admin(u.auth_user_id) then 'Amministratore Workspace'
   when s.metadati->>'admin_only'='true' then 'Riservata agli amministratori'
   when e.decisione is not null then 'Eccezione personale: '||e.decisione
   when s.aree && workspace_area_access_codes(u.auth_user_id) then 'Area autorizzata: '||
     (select string_agg(code,', ' order by code) from unnest(s.aree) code where code=any(workspace_area_access_codes(u.auth_user_id)))||' (indipendente dal modulo)'
   when a.level<>'nessuno' then 'Modulo collegato autorizzato'
   else 'Nessuna area, eccezione o modulo autorizzato' end
 from utenti u cross join workspace_schermate s
 cross join lateral (select workspace_screen_level_for_user(u.id,s.codice) level) a
 left join lateral workspace_personal_exception(u.id,'schermata',s.codice) e on true
 where u.id=target_user_id order by s.ordine,s.codice;
end $fn$;
notify pgrst,'reload schema';

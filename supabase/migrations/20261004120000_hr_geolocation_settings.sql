begin;
-- Global smartphone policy; site coordinates continue to use the existing HR sites.
-- Historical attendance rows and their recorded perimeter are never rewritten.
create table public.workspace_hr_geolocation_config (
 id boolean primary key default true check(id),
 presence_radius integer not null default 150 check(presence_radius between 1 and 1000000),
 max_accuracy integer not null default 30 check(max_accuracy between 1 and 1000000),
 updated_at timestamptz not null default now(), updated_by uuid references public.utenti(id)
);
insert into public.workspace_hr_geolocation_config(id) values(true);
alter table public.workspace_hr_geolocation_config enable row level security;
revoke all on public.workspace_hr_geolocation_config from public,anon,authenticated;

insert into public.workspace_aree(codice,nome,icona,ordine,attiva,protetta)
values('configurazioni','Configurazioni','settings',95,true,false) on conflict(codice) do nothing;

-- Reuse the installed Altre impostazioni module, including its existing grants.
do $$ declare other_code text; settings_menu text; begin
 select codice into other_code from public.workspace_moduli where lower(btrim(nome))='altre impostazioni' and attivo order by codice limit 1;
 if other_code is null then
  other_code:='altre_impostazioni';
  insert into public.workspace_moduli(codice,nome,descrizione,tipo,area,aree,percorso,provider,sempre_disponibile,assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,icona)
  values(other_code,'Altre impostazioni','Configurazioni aggiuntive Workspace.','contenitore','configurazioni',array['configurazioni'],'/settings/other','workspace',false,true,true,true,true,160,'settings');
 end if;
 insert into public.workspace_schermate(codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,aree,icona,metadati)
 values
 ('impostazioni.geolocalizzazione','Impostazioni Geolocalizzazione','Raggio presenza e accuracy GPS massima ammessa.','workspace','/settings/geolocation','GeolocationSettings',false,true,10,'configurazioni',array['configurazioni'],'map-pin','{}'),
 ('impostazioni.altre','Altre impostazioni','Configurazioni aggiuntive Workspace.','workspace','/settings/other','OtherSettings',false,true,160,'configurazioni',array['configurazioni'],'settings','{"kind":"topic"}');
 insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
 values(other_code,'impostazioni.geolocalizzazione',10,false,true),(other_code,'impostazioni.altre',0,false,false);
 -- Keep the existing menu composition. Only add a missing membership.
 if not exists(select 1 from public.workspace_menu_moduli where modulo_codice=other_code) then
  select codice into settings_menu from public.workspace_menu_voci where codice='impostazioni' or lower(btrim(nome))='impostazioni' order by codice limit 1;
  if settings_menu is null then
   settings_menu:='impostazioni';
   insert into public.workspace_menu_voci(codice,nome,descrizione,icona,ordine,attiva)
   values(settings_menu,'Impostazioni','Configurazioni Workspace.','settings',160,true);
  end if;
  insert into public.workspace_menu_moduli(voce_codice,modulo_codice,ordine) values(settings_menu,other_code,160);
 end if;
 if other_code<>'impostazioni' and exists(select 1 from public.workspace_moduli where codice='impostazioni') then
  insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
  values('impostazioni','impostazioni.altre',160,false,true);
 end if;
end $$;

create function public.workspace_hr_geolocation_settings() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=workspace_current_profile_id(); result jsonb;
begin
 if actor is null or workspace_screen_level_for_user(actor,'impostazioni.geolocalizzazione') not in ('lettura','scrittura','amministrazione') then
  raise exception 'Accesso alle impostazioni geolocalizzazione non autorizzato' using errcode='42501'; end if;
 select to_jsonb(c)-'id' into result from workspace_hr_geolocation_config c where id;
 return result;
end $$;
create function public.workspace_hr_save_geolocation_settings(p_radius integer,p_accuracy integer) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=workspace_current_profile_id(); result jsonb;
begin
 if actor is null or workspace_screen_level_for_user(actor,'impostazioni.geolocalizzazione') not in ('scrittura','amministrazione') then
  raise exception 'Salvataggio impostazioni geolocalizzazione non autorizzato' using errcode='42501'; end if;
 if p_radius is null or p_accuracy is null or p_radius not between 1 and 1000000 or p_accuracy not between 1 and 1000000 then
  raise exception 'Inserisci valori interi positivi in metri (massimo 1000000)'; end if;
 update workspace_hr_geolocation_config set presence_radius=p_radius,max_accuracy=p_accuracy,updated_at=clock_timestamp(),updated_by=actor where id;
 select to_jsonb(c)-'id' into result from workspace_hr_geolocation_config c where id;
 insert into workspace_hr_audit(actor_id,action,details) values(actor,'configure.geolocation',result);
 return result;
end $$;
revoke all on function public.workspace_hr_geolocation_settings() from public,anon;
revoke all on function public.workspace_hr_save_geolocation_settings(integer,integer) from public,anon;
grant execute on function public.workspace_hr_geolocation_settings() to authenticated;
grant execute on function public.workspace_hr_save_geolocation_settings(integer,integer) to authenticated;

create or replace function public.workspace_hr_location_punch(p_action text,p_key uuid,p_position jsonb,p_attendance_id uuid default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor(); a workspace_hr_attendance; s workspace_hr_sites;
 stamp timestamptz:=clock_timestamp(); lat double precision; lon double precision; acc double precision;
 sampled timestamptz; distance double precision; site_key uuid; reason text:=btrim(coalesce(p_reason,'')); outside boolean; cfg workspace_hr_geolocation_config; diagnostics jsonb;
begin
 if p_action is null or p_action not in ('in','out','observe') or p_key is null then raise exception 'Timbratura non valida'; end if;
 if not exists(select 1 from workspace_hr_members where user_id=actor and active) then raise exception 'Scheda dipendente non attiva' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hr:'||actor,0));
 if p_action='in' then
  select * into a from workspace_hr_attendance where request_key=p_key and user_id=actor;
  if found then return jsonb_build_object('id',a.id,'checkout_at',a.checkout_at,'checkout_kind',a.checkout_kind); end if;
  if exists(select 1 from workspace_hr_attendance where user_id=actor and checkout_at is null) then raise exception 'Hai già una presenza aperta'; end if;
  select site_id into site_key from workspace_hr_plan(actor,(stamp at time zone 'Europe/Rome')::date) limit 1;
  if site_key is null then select site_id into site_key from workspace_hr_contracts where user_id=actor and effective_from<=(stamp at time zone 'Europe/Rome')::date order by effective_from desc,created_at desc limit 1; end if;
  if site_key is null and (select count(*) from workspace_hr_sites)=1 then select id into site_key from workspace_hr_sites; end if;
  select * into s from workspace_hr_sites where id=site_key;
  if s.id is null then raise exception 'Sede non assegnata: contatta l’amministratore'; end if;
 else
  select * into a from workspace_hr_attendance where id=p_attendance_id and user_id=actor for update;
  if not found then raise exception 'Presenza non trovata' using errcode='42501'; end if;
  if a.checkout_at is not null then return jsonb_build_object('id',a.id,'checkout_at',a.checkout_at,'checkout_kind',a.checkout_kind); end if;
  s.latitude:=a.site_latitude; s.longitude:=a.site_longitude; s.checkout_radius:=a.checkout_radius;
 end if;
 select * into strict cfg from workspace_hr_geolocation_config where id;
 lat:=(p_position->>'latitude')::double precision; lon:=(p_position->>'longitude')::double precision;
 acc:=(p_position->>'accuracy')::double precision; sampled:=(p_position->>'sampled_at')::timestamptz;
 if lat is null or lon is null or acc is null or sampled is null or not(lat between -90 and 90) or not(lon between -180 and 180)
   or not(acc>=0 and acc<'Infinity'::double precision) or sampled<stamp-interval '30 seconds' or sampled>stamp+interval '5 seconds' then
  raise exception 'Posizione non attendibile o scaduta. Consenti la posizione precisa e riprova';
 end if;
 distance:=workspace_hr_distance(lat,lon,s.latitude,s.longitude);
 diagnostics:=jsonb_build_object('verification','gps','user_id',actor,'observed_at',stamp,'sampled_at',sampled,
  'latitude',lat,'longitude',lon,'accuracy',acc,'distance',distance,'presence_radius',cfg.presence_radius,
  'max_accuracy',cfg.max_accuracy,'evaluation',case when acc>cfg.max_accuracy then 'ACCURACY_INSUFFICIENTE' when distance>cfg.presence_radius then 'FUORI' else 'DENTRO' end,
  'gps_error',null);
 if acc>cfg.max_accuracy then
  insert into workspace_hr_audit(actor_id,action,target_id,details) values(actor,'punch.ignored',a.id,diagnostics);
  return jsonb_build_object('id',a.id,'checkout_at',a.checkout_at,'ignored',true,'evaluation','ACCURACY_INSUFFICIENTE',
   'message',format('Accuracy GPS insufficiente: %s m, massimo ammesso %s m. Presenza invariata.',round(acc::numeric,1),cfg.max_accuracy));
 end if;
 outside:=distance>cfg.presence_radius;
 if p_action='in' then
  if outside then raise exception 'Avvicinati alla sede: ingresso consentito entro % metri',cfg.presence_radius; end if;
  insert into workspace_hr_attendance(user_id,site_id,request_key,entry_distance,entry_accuracy,site_latitude,site_longitude,checkout_radius,auto_checkout)
   values(actor,s.id,p_key,distance,acc,s.latitude,s.longitude,cfg.presence_radius,true) returning * into a;
 elsif p_action='observe' then
  if not a.auto_checkout or not outside then return jsonb_build_object('id',a.id,'checkout_at',null); end if;
  update workspace_hr_attendance set checkout_at=stamp,checkout_kind='automatic',exit_distance=distance,exit_accuracy=acc,
   exit_reason='Uscita registrata dalla prima rilevazione GPS valida fuori dal perimetro' where id=a.id returning * into a;
 else
  -- Preserve the existing reason requirement for a valid manual outside checkout.
  if outside and (reason='' or length(reason)>2000) then raise exception 'Inserisci il motivo dell’uscita registrata fuori sede'; end if;
  if length(reason)>2000 then raise exception 'Motivazione troppo lunga'; end if;
  update workspace_hr_attendance set checkout_at=stamp,checkout_kind='manual',exit_distance=distance,exit_accuracy=acc,
   exit_reason=nullif(reason,'') where id=a.id returning * into a;
 end if;
 insert into workspace_hr_audit(actor_id,action,target_id,details) values(actor,'punch.'||p_action,a.id,
  diagnostics||jsonb_build_object('event_type',case when p_action='in' then 'ENTRATA' else 'USCITA' end,'evaluation',case when p_action<>'in' then 'USCITA' else 'DENTRO' end,'checkout_kind',a.checkout_kind,'outside',outside,'reason',a.exit_reason));
 if p_action<>'in' and (outside or a.checkout_kind='automatic') then
  insert into notifiche(utente_id,titolo,messaggio,tipo,evento,url,metadata)
  select recipient,'Uscita fuori sede',concat_ws(' ',u.nome,u.cognome)||' · '||
   case when a.checkout_kind='automatic' then 'Checkout automatico per allontanamento' else 'Checkout manuale fuori sede' end||
   ' · '||to_char(stamp at time zone 'Europe/Rome','DD-MM-YYYY HH24:MI')||coalesce(' · '||a.exit_reason,''),
   'generica','hr_uscita_fuori_sede','/hr',jsonb_build_object('hr_attendance_id',a.id)
  from (select actor recipient union select reviewer_id from workspace_hr_employee_recipients where employee_id=actor) recipients
  join utenti recipient_user on recipient_user.id=recipient and recipient_user.attivo is not false
  cross join utenti u where u.id=actor;
 end if;
 return jsonb_build_object('id',a.id,'checkout_at',a.checkout_at,'checkout_kind',a.checkout_kind);
end $$;
revoke all on function public.workspace_hr_location_punch(text,uuid,jsonb,uuid,text) from public,anon;
grant execute on function public.workspace_hr_location_punch(text,uuid,jsonb,uuid,text) to authenticated;


-- workspace_hr_punch already delegates observations to this authoritative function.
notify pgrst,'reload schema';
commit;

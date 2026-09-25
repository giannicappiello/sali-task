begin;

alter table public.workspace_hr_attendance add column if not exists exit_reason text;

create or replace function public.workspace_hr_location_punch(p_action text,p_key uuid,p_position jsonb,p_attendance_id uuid default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor(); a workspace_hr_attendance; s workspace_hr_sites;
 stamp timestamptz:=clock_timestamp(); lat double precision; lon double precision; acc double precision;
 sampled timestamptz; distance double precision; site_key uuid; reason text:=btrim(coalesce(p_reason,'')); outside boolean;
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
 lat:=(p_position->>'latitude')::double precision; lon:=(p_position->>'longitude')::double precision;
 acc:=(p_position->>'accuracy')::double precision; sampled:=(p_position->>'sampled_at')::timestamptz;
 if lat is null or lon is null or acc is null or sampled is null or not(lat between -90 and 90) or not(lon between -180 and 180)
   or not(acc between 0 and 50) or sampled<stamp-interval '30 seconds' or sampled>stamp+interval '5 seconds' then
  raise exception 'Posizione non attendibile o scaduta. Consenti la posizione precisa e riprova';
 end if;
 distance:=workspace_hr_distance(lat,lon,s.latitude,s.longitude);
 outside:=distance-acc>s.checkout_radius;
 if p_action='in' then
  if distance+acc>s.checkin_radius then raise exception 'Avvicinati alla sede: ingresso consentito entro % metri con posizione precisa',s.checkin_radius; end if;
  insert into workspace_hr_attendance(user_id,site_id,request_key,entry_distance,entry_accuracy,site_latitude,site_longitude,checkout_radius,auto_checkout)
   values(actor,s.id,p_key,distance,acc,s.latitude,s.longitude,s.checkout_radius,true) returning * into a;
 elsif p_action='observe' then
  if not a.auto_checkout or not outside then return jsonb_build_object('id',a.id,'checkout_at',null); end if;
  update workspace_hr_attendance set checkout_at=stamp,checkout_kind='automatic',exit_distance=distance,exit_accuracy=acc,
   exit_reason='Allontanamento confermato da una rilevazione GPS attendibile',outside_since=null,last_outside_at=null where id=a.id returning * into a;
 else
  -- Manual checkout outside the perimeter needs an explanation, even at its uncertain edge.
  if distance+acc>s.checkout_radius and (reason='' or length(reason)>2000) then raise exception 'Inserisci il motivo dell’uscita registrata fuori sede'; end if;
  if length(reason)>2000 then raise exception 'Motivazione troppo lunga'; end if;
  update workspace_hr_attendance set checkout_at=stamp,checkout_kind='manual',exit_distance=distance,exit_accuracy=acc,
   exit_reason=nullif(reason,''),outside_since=null,last_outside_at=null where id=a.id returning * into a;
 end if;
 insert into workspace_hr_audit(actor_id,action,target_id,details) values(actor,'punch.'||p_action,a.id,
  jsonb_build_object('verification','gps','checkout_kind',a.checkout_kind,'outside',outside,'reason',a.exit_reason));
 if p_action<>'in' and (distance+acc>s.checkout_radius or a.checkout_kind='automatic') then
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

-- Existing open sessions and observation clients use the same new rule.
create or replace function public.workspace_hr_punch(p_action text,p_key uuid,p_position jsonb default null,p_attendance_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if p_action is distinct from 'observe' then raise exception 'Aggiorna Workspace per usare le nuove timbrature GPS'; end if;
 return workspace_hr_location_punch(p_action,p_key,p_position,p_attendance_id,null);
end $$;
-- Retired network-only endpoint cannot bypass the location requirement.
create or replace function public.workspace_hr_network_punch(p_auth_user uuid,p_action text,p_key uuid,p_ip inet,p_attendance_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin raise exception 'Aggiorna Workspace: entrata e uscita richiedono la verifica puntuale della posizione'; end $$;

-- Internal authoritative calculation. No browser-supplied durations are trusted.
create or replace function public.workspace_hr_excess_day(p_user uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare lo timestamptz:=p_day::timestamp at time zone 'Europe/Rome'; hi timestamptz:=(p_day+1)::timestamp at time zone 'Europe/Rome';
 actual tstzmultirange; planned tstzmultirange; reserved tstzmultirange; available tstzmultirange;
 gross numeric; planned_gross numeric; pause numeric; gaps numeric; reserved_minutes numeric; remaining numeric;
 source text; slots jsonb; c workspace_hr_contracts;
begin
 select * into c from workspace_hr_contracts where user_id=p_user and effective_from<=p_day order by effective_from desc,created_at desc limit 1;
 if not found or c.start_time is null or c.end_time is null or c.weekdays is null or c.break_minutes is null then return null; end if;
 if exists(select 1 from workspace_hr_attendance where user_id=p_user and checkin_at<hi and (checkout_at is null or checkout_at>lo)
  and (checkout_at is null or checkout_at>now() or checkout_at-checkin_at>interval '24 hours')) then return null; end if;
 select coalesce(range_agg(tstzrange(greatest(checkin_at,lo),least(checkout_at,hi),'[)')),'{}'::tstzmultirange),
  md5(coalesce(jsonb_agg(to_jsonb(a) order by a.id)::text,'')) into actual,source
 from workspace_hr_attendance a where user_id=p_user and checkin_at<hi and checkout_at>lo;
 if isempty(actual) then return null; end if;
 select coalesce(range_agg(tstzrange(greatest(starts_at,lo),least(ends_at,hi),'[)')),'{}'::tstzmultirange),
  coalesce(sum(break_minutes*extract(epoch from least(ends_at,hi)-greatest(starts_at,lo))/nullif(extract(epoch from ends_at-starts_at),0)),0)
 into planned,pause from generate_series(p_day-1,p_day,interval '1 day') d cross join lateral workspace_hr_plan(p_user,d::date) p
 where starts_at<hi and ends_at>lo;
 select coalesce(range_agg(tstzrange(greatest(starts_at,lo),least(ends_at,hi),'[)')),'{}'::tstzmultirange)
 into reserved from workspace_hr_requests where user_id=p_user and status in ('approved','pending') and kind<>'correction' and starts_at<hi and ends_at>lo;
 select coalesce(sum(extract(epoch from upper(r)-lower(r))/60),0) into gross from unnest(actual) r;
 select coalesce(sum(extract(epoch from upper(r)-lower(r))/60),0) into planned_gross from unnest(planned) r;
 -- Only gaps between actual punches can represent an already clocked-out break.
 -- Late arrival or early departure must not consume the contractual lunch break.
 select coalesce(sum(extract(epoch from upper(r)-lower(r))/60),0) into gaps
 from unnest((planned*tstzmultirange(tstzrange(lower(actual),upper(actual),'[)')))-actual) r;
 select coalesce(sum(extract(epoch from upper(r)-lower(r))/60),0) into reserved_minutes from unnest(reserved) r;
 remaining:=greatest(0,gross-greatest(0,pause-gaps)-greatest(0,planned_gross-pause)-reserved_minutes);
 available:=actual-planned-reserved;
 select least(remaining,coalesce(sum(extract(epoch from upper(r)-lower(r))/60),0)),
  jsonb_agg(jsonb_build_object('from',lower(r),'to',upper(r)) order by lower(r)) into remaining,slots from unnest(available) r;
 remaining:=floor(remaining); -- whole minutes; never round unworked seconds up
 if remaining<1 then return null; end if;
 return jsonb_build_object('user_id',p_user,'day',p_day,'minutes',remaining,'worked_minutes',round(gross-greatest(0,pause-gaps),2),
  'planned_minutes',round(greatest(0,planned_gross-pause),2),'slots',slots,
  'token',md5(source||planned::text||reserved::text||c::text||remaining::text));
end $$;
revoke all on function public.workspace_hr_excess_day(uuid,date) from public,anon,authenticated;

create or replace function public.workspace_hr_excess_candidates(p_month date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor(); result jsonb;
begin
 if not workspace_user_is_admin() then raise exception 'Riepilogo economico riservato agli amministratori' using errcode='42501'; end if;
 if p_month is null then raise exception 'Mese non valido'; end if;
 select coalesce(jsonb_agg(candidate order by candidate->>'day',candidate->>'user_id'),'[]') into result from (
  select workspace_hr_excess_day(user_id,work_day::date) candidate from (
   select distinct a.user_id,d as work_day from workspace_hr_attendance a
   cross join lateral generate_series(greatest((a.checkin_at at time zone 'Europe/Rome')::date,date_trunc('month',p_month)::date),
    least((a.checkout_at at time zone 'Europe/Rome')::date,(date_trunc('month',p_month)+interval '1 month - 1 day')::date),interval '1 day') d
   where a.checkout_at is not null and a.checkin_at<(date_trunc('month',p_month)+interval '1 month')::timestamp at time zone 'Europe/Rome'
    and a.checkout_at>date_trunc('month',p_month)::timestamp at time zone 'Europe/Rome'
  ) days
 ) calculated where candidate is not null;
 return result;
end $$;
revoke all on function public.workspace_hr_excess_candidates(date) from public,anon;
grant execute on function public.workspace_hr_excess_candidates(date) to authenticated;

create or replace function public.workspace_hr_convert_excess(p_user uuid,p_day date,p_minutes integer,p_token text,p_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor(); candidate jsonb; prior jsonb; slot jsonb; remaining integer:=p_minutes;
 stamp timestamptz; finish timestamptz; take_minutes integer; request_id uuid; ids uuid[]:='{}';
begin
 if not workspace_user_is_admin() then raise exception 'Conversione riservata agli amministratori' using errcode='42501'; end if;
 if p_user is null or p_day is null or p_minutes is null or p_minutes<=0 or p_key is null or p_token is null then raise exception 'Conversione non valida'; end if;
 perform pg_advisory_xact_lock(hashtextextended('hr:'||p_user,0));
 select details into prior from workspace_hr_audit where action='overtime.convert' and target_id=p_key and actor_id=actor;
 if found then
  if prior->>'user_id'<>p_user::text or prior->>'day'<>p_day::text or (prior->>'minutes')::integer<>p_minutes or prior->>'token'<>p_token then raise exception 'Identificativo conversione già utilizzato'; end if;
  return prior;
 end if;
 candidate:=workspace_hr_excess_day(p_user,p_day);
 if candidate is null or candidate->>'token'<>p_token or (candidate->>'minutes')::integer<p_minutes then raise exception 'Le presenze o gli straordinari sono cambiati. Aggiorna il riepilogo e verifica la nuova proposta'; end if;
 for slot in select value from jsonb_array_elements(candidate->'slots') loop
  stamp:=(slot->>'from')::timestamptz;
  take_minutes:=least(remaining,floor(extract(epoch from (slot->>'to')::timestamptz-stamp)/60)::integer);
  if take_minutes<=0 then continue; end if;
  finish:=stamp+make_interval(mins=>take_minutes);
  insert into workspace_hr_requests(request_key,user_id,kind,starts_at,ends_at,note,status,reviewed_by,reviewed_at,review_note)
   values(gen_random_uuid(),p_user,'overtime',stamp,finish,'Conversione ore eccedenti rilevate del '||to_char(p_day,'DD-MM-YYYY'),
    'approved',actor,now(),'Approvato dal riepilogo economico') returning id into request_id;
  ids:=array_append(ids,request_id); remaining:=remaining-take_minutes;
  exit when remaining=0;
 end loop;
 if remaining<>0 then raise exception 'Intervalli insufficienti: aggiorna la proposta'; end if;
 prior:=jsonb_build_object('user_id',p_user,'day',p_day,'minutes',p_minutes,'token',p_token,'request_ids',ids);
 insert into workspace_hr_audit(actor_id,action,target_id,details) values(actor,'overtime.convert',p_key,prior);
 return prior;
end $$;
revoke all on function public.workspace_hr_convert_excess(uuid,date,integer,text,uuid) from public,anon;
grant execute on function public.workspace_hr_convert_excess(uuid,date,integer,text,uuid) to authenticated;
do $$ declare original text; updated text; begin
 original:=pg_get_functiondef('public.workspace_hr_notify_request()'::regprocedure);
 if position('new.status' in original)=0 then
  updated:=replace(original,'begin','begin'||E'\n if new.status<>''pending'' then return new; end if;');
  if updated=original then raise exception 'Contratto notifiche HR inatteso'; end if;
  execute updated;
 end if;
end $$;
update public.workspace_schermate set nome='Rendicontazioni HR' where codice='impostazioni.hr';
notify pgrst,'reload schema';
commit;

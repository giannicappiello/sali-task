begin;
-- Desktop punches use the trusted server IP. Mobile location verification is unchanged.
create or replace function public.workspace_hr_network_punch(p_auth_user uuid,p_action text,p_key uuid,p_ip inet,p_attendance_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid; a workspace_hr_attendance; s workspace_hr_sites; site_key uuid; stamp timestamptz:=clock_timestamp();
begin
  perform set_config('request.jwt.claim.sub',p_auth_user::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_auth_user,'role','authenticated')::text,true);
  actor:=workspace_hr_actor();
  if p_action not in ('in','out') or p_action is null or p_key is null or not workspace_hr_public_ip(p_ip) then raise exception 'Timbratura non valida'; end if;
  if not exists(select 1 from workspace_hr_members where user_id=actor and active) then raise exception 'Scheda dipendente non attiva' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hr:'||actor,0));
  if p_action='in' then
    select * into a from workspace_hr_attendance where user_id=actor and request_key=p_key;
    if found then site_key:=a.site_id;
    else
      select site_id into site_key from workspace_hr_plan(actor,(stamp at time zone 'Europe/Rome')::date) limit 1;
      if site_key is null then select site_id into site_key from workspace_hr_contracts where user_id=actor and effective_from<=(stamp at time zone 'Europe/Rome')::date order by effective_from desc,created_at desc limit 1; end if;
      if site_key is null and (select count(*) from workspace_hr_sites)=1 then select id into site_key from workspace_hr_sites; end if;
    end if;
  else
    select * into a from workspace_hr_attendance where id=p_attendance_id and user_id=actor for update;
    if not found then raise exception 'Presenza non trovata' using errcode='42501'; end if;
    site_key:=a.site_id;
  end if;
  select * into s from workspace_hr_sites where id=site_key;
  if s.id is null then raise exception 'Sede non assegnata: contatta l’admin'; end if;
  if cardinality(s.public_ips)=0 then raise exception 'IP della sede non configurato: contatta l’admin'; end if;
  if not p_ip=any(s.public_ips) then raise exception 'Collegati al Wi-Fi o alla LAN aziendale per registrare entrata e uscita' using errcode='42501'; end if;
  if p_action='in' then
    if a.id is not null then return jsonb_build_object('id',a.id,'checkout_at',a.checkout_at,'checkout_kind',a.checkout_kind); end if;
    if exists(select 1 from workspace_hr_attendance where user_id=actor and checkout_at is null) then raise exception 'Hai già una presenza aperta'; end if;
    insert into workspace_hr_attendance(user_id,site_id,request_key,entry_ip,site_latitude,site_longitude,checkout_radius,auto_checkout)
      values(actor,s.id,p_key,p_ip,s.latitude,s.longitude,s.checkout_radius,false) returning * into a;
  else
    if a.checkout_at is not null then return jsonb_build_object('id',a.id,'checkout_at',a.checkout_at,'checkout_kind',a.checkout_kind); end if;
    update workspace_hr_attendance set checkout_at=stamp,checkout_kind='manual',exit_ip=p_ip,outside_since=null,last_outside_at=null where id=a.id returning * into a;
  end if;
  insert into workspace_hr_audit(actor_id,action,target_id,details) values(actor,'punch.'||p_action,a.id,jsonb_build_object('verification','company_network','site_id',s.id));
  return jsonb_build_object('id',a.id,'checkout_at',a.checkout_at,'checkout_kind',a.checkout_kind);
end $$;
revoke all on function public.workspace_hr_network_punch(uuid,text,uuid,inet,uuid) from public,anon,authenticated;
grant execute on function public.workspace_hr_network_punch(uuid,text,uuid,inet,uuid) to service_role;
notify pgrst,'reload schema';
commit;

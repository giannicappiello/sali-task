begin;
alter table public.workspace_hr_sites add column public_ips inet[] not null default '{}';
alter table public.workspace_hr_attendance alter column entry_distance drop not null;
alter table public.workspace_hr_attendance alter column entry_accuracy drop not null;
alter table public.workspace_hr_attendance add column entry_ip inet;
alter table public.workspace_hr_attendance add column exit_ip inet;

create function public.workspace_hr_public_ip(value inet) returns boolean
language sql immutable set search_path=public as $$
  select value is not null and
    case when family(value)=4 then masklen(value)=32 and not(value <<= any(array['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.168.0.0/16','192.0.0.0/24','192.0.2.0/24','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/3']::inet[]))
    else masklen(value)=128 and value <<= '2000::/3'::inet and not value <<= '2001:db8::/32'::inet end;
$$;
revoke all on function public.workspace_hr_public_ip(inet) from public,anon,authenticated;

alter function public.workspace_hr_configure(text,jsonb) rename to workspace_hr_configure_base;
revoke all on function public.workspace_hr_configure_base(text,jsonb) from public,anon,authenticated;
create function public.workspace_hr_configure(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb; ips inet[]; item text;
begin
  if not workspace_user_is_admin() then raise exception 'Configurazioni riservate agli admin' using errcode='42501'; end if;
  if p_action='site' and p_data ? 'public_ips' then
    if jsonb_typeof(p_data->'public_ips')<>'array' then raise exception 'Inserisci un elenco di IP pubblici'; end if;
    if jsonb_array_length(p_data->'public_ips')>20 then raise exception 'Massimo 20 IP per sede'; end if;
    ips:='{}';
    for item in select jsonb_array_elements_text(p_data->'public_ips') loop
      if not workspace_hr_public_ip(item::inet) then raise exception 'IP pubblico non valido: usa indirizzi singoli, non indirizzi locali o intervalli'; end if;
      if not item::inet=any(ips) then ips:=array_append(ips,item::inet); end if;
    end loop;
  end if;
  result:=workspace_hr_configure_base(p_action,p_data);
  if ips is not null then update workspace_hr_sites set public_ips=ips where id=(result->>'id')::uuid; end if;
  return result;
end $$;
revoke all on function public.workspace_hr_configure(text,jsonb) from public,anon;
grant execute on function public.workspace_hr_configure(text,jsonb) to authenticated;

-- Existing mobile observation remains the automatic safety exception. Manual
-- punches through the old browser RPC are denied, including stale PWA clients.
alter function public.workspace_hr_punch(text,uuid,jsonb,uuid) rename to workspace_hr_punch_gps;
revoke all on function public.workspace_hr_punch_gps(text,uuid,jsonb,uuid) from public,anon,authenticated;
create function public.workspace_hr_punch(p_action text,p_key uuid,p_position jsonb default null,p_attendance_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if p_action is distinct from 'observe' then raise exception 'Aggiorna Workspace: entrata e uscita richiedono la rete aziendale' using errcode='42501'; end if;
  return workspace_hr_punch_gps(p_action,p_key,p_position,p_attendance_id);
end $$;
revoke all on function public.workspace_hr_punch(text,uuid,jsonb,uuid) from public,anon;
grant execute on function public.workspace_hr_punch(text,uuid,jsonb,uuid) to authenticated;

-- Only the server may supply a validated identity and the ingress IP.
create function public.workspace_hr_network_punch(p_auth_user uuid,p_action text,p_key uuid,p_ip inet,p_attendance_id uuid default null)
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
      values(actor,s.id,p_key,p_ip,s.latitude,s.longitude,s.checkout_radius,s.auto_checkout) returning * into a;
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


-- Preserve recorded clocking history. From this date presence is derived from employee schedules.
alter function public.workspace_hr_snapshot(date,boolean) rename to workspace_hr_snapshot_clocking_history;
revoke all on function public.workspace_hr_snapshot_clocking_history(date,boolean) from public,anon,authenticated;
create function public.workspace_hr_snapshot(p_month date default current_date,p_config boolean default false)
returns jsonb language plpgsql stable security definer set search_path=public as $snapshot$
declare result jsonb;begin
 result:=public.workspace_hr_snapshot_clocking_history(p_month,p_config);
 return result||jsonb_build_object('attendance_policy',jsonb_build_object('mode','default_present','effective_from','2026-11-01','clocking_enabled',false),
 'presence_schedules',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'user_id',c.user_id,'effective_from',c.effective_from,'created_at',c.created_at,
 'weekdays',c.weekdays,'start_time',c.start_time,'end_time',c.end_time,'break_minutes',c.break_minutes)),'[]'::jsonb)
 from workspace_hr_contracts c where c.user_id in(select (e->>'user_id')::uuid from jsonb_array_elements(result->'employees') e)));
end $snapshot$;
revoke all on function public.workspace_hr_snapshot(date,boolean) from public,anon;
grant execute on function public.workspace_hr_snapshot(date,boolean) to authenticated,service_role;

-- Block every clocking entry point, including stale desktop/mobile clients and GPS observations.
do $disable$ declare fn regprocedure; definition text; marker integer;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('workspace_hr_punch','workspace_hr_location_punch','workspace_hr_network_punch','workspace_hr_punch_gps')
 loop
  definition:=pg_get_functiondef(fn);
  marker:=strpos(definition,'AS $function$');
  if marker=0 then raise exception 'Unexpected clocking function definition: %',fn;end if;
  execute left(definition,marker-1)||$body$AS $function$ begin raise exception 'Timbrature disattivate: la presenza segue gli orari della scheda dipendente e le assenze approvate.' using errcode='55000'; end $function$;$body$;
 end loop;
end $disable$;
create or replace function public.workspace_hr_punch_status() returns jsonb
language plpgsql stable security definer set search_path=public as $status$
declare actor uuid:=workspace_hr_actor();begin
 return jsonb_build_object('actor_id',actor,'member',exists(select 1 from workspace_hr_members where user_id=actor and active),
  'open',null,'clocking_enabled',false,'attendance_mode','default_present');
end $status$;
create or replace function public.workspace_hr_open_session() returns jsonb
language plpgsql stable security definer set search_path=public as $session$
begin perform workspace_hr_actor();return null;end $session$;
notify pgrst,'reload schema';

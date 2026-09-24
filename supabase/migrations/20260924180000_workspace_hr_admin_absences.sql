begin;

-- Admin-scheduled absences are created as approved records so they are immediately
-- visible in HR calendars and are excluded from the derived unjustified absence list.
-- The existing employee request flow remains unchanged.
create or replace function public.workspace_hr_admin_request(p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor uuid:=workspace_hr_actor();
  target uuid:=(p_data->>'user_id')::uuid;
  request_id uuid:=coalesce(nullif(p_data->>'request_key','')::uuid,gen_random_uuid());
  kind text:=p_data->>'kind';
  starts_at timestamptz:=(p_data->>'starts_at')::timestamptz;
  ends_at timestamptz:=(p_data->>'ends_at')::timestamptz;
  note text:=btrim(coalesce(p_data->>'note',''));
  created_id uuid;
begin
  if not workspace_user_is_admin() and not exists(select 1 from workspace_hr_members where user_id=actor and active and manager) then
    raise exception 'Gestione HR non autorizzata' using errcode='42501';
  end if;
  if target is null or not exists(select 1 from workspace_hr_members where user_id=target and active) then raise exception 'Dipendente non attivo'; end if;
  if kind not in ('leave','permission','illness','pregnancy') then raise exception 'Causale assenza non valida'; end if;
  if starts_at is null or ends_at is null or ends_at<=starts_at or ends_at-starts_at>interval '366 days' then raise exception 'Periodo assenza non valido'; end if;
  if note='' or length(note)>2000 then raise exception 'Inserisci una motivazione'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hr:'||target,0));
  if exists(select 1 from workspace_hr_requests r where r.user_id=target and r.status='approved'
    and r.kind in ('leave','permission','illness','pregnancy','overtime')
    and r.starts_at<ends_at and r.ends_at>starts_at) then
    raise exception 'Periodo sovrapposto a una richiesta già approvata';
  end if;
  insert into workspace_hr_requests(request_key,user_id,kind,starts_at,ends_at,note,status,reviewed_by,reviewed_at)
    values(request_id,target,kind,starts_at,ends_at,note,'approved',actor,now()) returning id into created_id;
  insert into workspace_hr_audit(actor_id,action,target_id,details)
    values(actor,'admin_request',created_id,jsonb_build_object('user_id',target,'kind',kind,'starts_at',starts_at,'ends_at',ends_at));
  return jsonb_build_object('id',created_id);
end $$;

revoke all on function public.workspace_hr_admin_request(jsonb) from public,anon;
grant execute on function public.workspace_hr_admin_request(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

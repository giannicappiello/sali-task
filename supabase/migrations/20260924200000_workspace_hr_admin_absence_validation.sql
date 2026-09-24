begin;

-- Upgrade existing databases; editing an already applied migration has no effect.
alter table public.workspace_hr_requests drop constraint workspace_hr_requests_kind_check;
alter table public.workspace_hr_requests add constraint workspace_hr_requests_kind_check
  check(kind in ('leave','permission','illness','pregnancy','overtime','correction'));

create or replace function public.workspace_hr_check_approved_overlap()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='approved' and new.kind in ('leave','permission','illness','pregnancy','overtime') then
    perform pg_advisory_xact_lock(hashtextextended('hr:'||new.user_id,0));
    if exists(select 1 from workspace_hr_requests r where r.id<>new.id and r.user_id=new.user_id
      and r.status='approved' and r.kind in ('leave','permission','illness','pregnancy','overtime')
      and r.starts_at<new.ends_at and r.ends_at>new.starts_at) then
      raise exception 'Periodo sovrapposto a una richiesta già approvata';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.workspace_hr_check_approved_overlap() from public,anon,authenticated;
drop trigger if exists workspace_hr_approved_overlap on public.workspace_hr_requests;
create trigger workspace_hr_approved_overlap before insert or update of status,user_id,kind,starts_at,ends_at
  on public.workspace_hr_requests for each row execute function public.workspace_hr_check_approved_overlap();

create or replace function public.workspace_hr_admin_request(p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=workspace_hr_actor();
  v_target uuid:=(p_data->>'user_id')::uuid;
  v_key uuid:=(p_data->>'request_key')::uuid;
  v_kind text:=p_data->>'kind';
  v_start timestamptz:=(p_data->>'starts_at')::timestamptz;
  v_end timestamptz:=(p_data->>'ends_at')::timestamptz;
  v_note text:=btrim(coalesce(p_data->>'note',''));
  v_existing workspace_hr_requests;
  v_id uuid;
begin
  if not workspace_user_is_admin() and not exists(select 1 from workspace_hr_members m where m.user_id=v_actor and m.active and m.manager) then
    raise exception 'Gestione HR non autorizzata' using errcode='42501';
  end if;
  if v_target is null or not exists(select 1 from workspace_hr_members m join utenti u on u.id=m.user_id where m.user_id=v_target and m.active and u.attivo) then
    raise exception 'Dipendente non attivo';
  end if;
  if v_key is null then raise exception 'Identificativo richiesta obbligatorio'; end if;
  if v_kind is null or v_kind not in ('leave','permission','illness','pregnancy') then raise exception 'Causale assenza non valida'; end if;
  if v_start is null or v_end is null or v_end<=v_start or v_end-v_start>interval '366 days' then raise exception 'Periodo assenza non valido'; end if;
  if v_note='' or length(v_note)>2000 then raise exception 'Inserisci una motivazione'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hr:'||v_target,0));
  select * into v_existing from workspace_hr_requests r where r.request_key=v_key;
  if found then
    if v_existing.user_id=v_target and v_existing.kind=v_kind and v_existing.starts_at=v_start
      and v_existing.ends_at=v_end and v_existing.note=v_note and v_existing.status='approved'
      and exists(select 1 from workspace_hr_audit a where a.target_id=v_existing.id and a.action='admin_request' and a.actor_id=v_actor) then
      return jsonb_build_object('id',v_existing.id);
    end if;
    raise exception 'Identificativo richiesta già utilizzato con dati diversi';
  end if;
  insert into workspace_hr_requests(request_key,user_id,kind,starts_at,ends_at,note,status,reviewed_by,reviewed_at)
    values(v_key,v_target,v_kind,v_start,v_end,v_note,'approved',v_actor,now()) returning id into v_id;
  insert into workspace_hr_audit(actor_id,action,target_id,details)
    values(v_actor,'admin_request',v_id,jsonb_build_object('user_id',v_target,'kind',v_kind,'starts_at',v_start,'ends_at',v_end));
  return jsonb_build_object('id',v_id);
end $$;
revoke all on function public.workspace_hr_admin_request(jsonb) from public,anon;
grant execute on function public.workspace_hr_admin_request(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

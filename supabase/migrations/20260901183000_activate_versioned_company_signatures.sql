begin;

create or replace function public.company_signature_add_version(
  p_signature_id uuid,p_storage_path text,p_original_filename text,p_mime_type text,p_size_bytes bigint,p_sha256 text,
  p_valid_from date default null,p_valid_to date default null
) returns table(version_id uuid,version integer) language plpgsql security definer set search_path=public as $$
declare v_user uuid:=public.company_letterhead_current_user(); v_version integer; v_id uuid; v_activated boolean:=false;
begin
  if v_user is null or not public.company_letterhead_can_manage() then raise exception 'FORBIDDEN'; end if;
  if p_mime_type not in ('image/png','image/jpeg') then raise exception 'INVALID_FILE_TYPE'; end if;
  perform 1 from public.company_signatures where id=p_signature_id for update; if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(max(sv.version),0)+1 into v_version from public.company_signature_versions sv where sv.signature_id=p_signature_id;
  insert into public.company_signature_versions(signature_id,version,storage_path,original_filename,mime_type,size_bytes,sha256,valid_from,valid_to,created_by)
  values(p_signature_id,v_version,p_storage_path,p_original_filename,p_mime_type,p_size_bytes,lower(p_sha256),p_valid_from,p_valid_to,v_user) returning id into v_id;
  update public.company_signatures set status=case when status='draft' then 'active' else status end,updated_by=v_user,updated_at=now()
  where id=p_signature_id returning status='active' into v_activated;
  insert into public.company_letterhead_audit(user_id,action,target_type,target_id,details)
  values(v_user,'signature_version_created','signature',p_signature_id::text,
    jsonb_build_object('version',v_version,'version_id',v_id,'sha256',lower(p_sha256),'activated',v_activated));
  return query select v_id,v_version;
end $$;

revoke all on function public.company_signature_add_version(uuid,text,text,text,bigint,text,date,date) from public,anon,authenticated;
grant execute on function public.company_signature_add_version(uuid,text,text,text,bigint,text,date,date) to authenticated;

commit;

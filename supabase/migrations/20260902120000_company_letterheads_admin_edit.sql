begin;

create or replace function public.company_letterhead_update(
  p_letterhead_id uuid,
  p_name text,
  p_code text,
  p_description text,
  p_company_brand text,
  p_kind text,
  p_language text,
  p_valid_from date,
  p_valid_to date,
  p_is_default boolean,
  p_notes text
) returns void language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=public.company_letterhead_current_user();
  v_before jsonb;
begin
  if v_user is null or not public.company_letterhead_can_manage() then raise exception 'FORBIDDEN'; end if;
  if p_valid_to is not null and p_valid_from is not null and p_valid_to < p_valid_from then raise exception 'INVALID_VALIDITY'; end if;

  select to_jsonb(h) - 'created_by' - 'updated_by' into v_before
  from public.company_letterheads h where h.id=p_letterhead_id for update;
  if v_before is null then raise exception 'NOT_FOUND'; end if;

  update public.company_letterheads
  set name=trim(p_name),
      code=upper(trim(p_code)),
      description=nullif(trim(p_description),''),
      company_brand=trim(p_company_brand),
      kind=coalesce(nullif(trim(p_kind),''),'carta_intestata'),
      language=coalesce(nullif(trim(p_language),''),'it'),
      valid_from=p_valid_from,
      valid_to=p_valid_to,
      is_default=case when status='active' then coalesce(p_is_default,false) else false end,
      notes=nullif(trim(p_notes),''),
      updated_by=v_user,
      updated_at=now()
  where id=p_letterhead_id;

  insert into public.company_letterhead_audit(user_id,action,target_type,target_id,details)
  select v_user,'updated','letterhead',p_letterhead_id::text,
    jsonb_build_object('before',v_before,'after',to_jsonb(h) - 'created_by' - 'updated_by')
  from public.company_letterheads h where h.id=p_letterhead_id;
end $$;

revoke all on function public.company_letterhead_update(uuid,text,text,text,text,text,text,date,date,boolean,text) from public,anon,authenticated;
grant execute on function public.company_letterhead_update(uuid,text,text,text,text,text,text,date,date,boolean,text) to authenticated;

commit;

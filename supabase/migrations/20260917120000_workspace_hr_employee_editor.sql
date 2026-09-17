begin;
create function public.workspace_hr_save_employee(p_data jsonb, p_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor(); target uuid:=(p_data->>'user_id')::uuid; latest uuid;
begin
  if not workspace_user_is_admin() then raise exception 'Configurazioni riservate agli admin' using errcode='42501'; end if;
  if p_key is null or target is null then raise exception 'Scheda non valida'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hr:'||target,0));
  if exists(select 1 from workspace_hr_audit where actor_id=actor and target_id=target and action='configure.employee' and details->>'request_key'=p_key::text) then
    return jsonb_build_object('id',target);
  end if;
  if jsonb_typeof(p_data->'contract')='object' then
    select id into latest from workspace_hr_contracts where user_id=target order by effective_from desc,created_at desc limit 1;
    if latest is distinct from nullif(p_data->>'contract_id','')::uuid then
      raise exception 'Gli accordi sono stati aggiornati. Riapri la scheda prima di salvare.';
    end if;
  end if;
  perform workspace_hr_configure('member', jsonb_build_object('user_id',target,'employee_code',p_data->>'employee_code','manager',p_data->'manager'));
  if jsonb_typeof(p_data->'contract')='object' then
    perform workspace_hr_configure('contract',(p_data->'contract')||jsonb_build_object('user_id',target));
  end if;
  insert into workspace_hr_audit(actor_id,action,target_id,details) values(actor,'configure.employee',target,jsonb_build_object('request_key',p_key));
  return jsonb_build_object('id',target);
end $$;
revoke all on function public.workspace_hr_save_employee(jsonb,uuid) from public,anon;
grant execute on function public.workspace_hr_save_employee(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;

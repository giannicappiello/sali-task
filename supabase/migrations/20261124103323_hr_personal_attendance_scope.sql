begin;

-- Keep the admin employee archive intact. Operational HR contains only the actor
-- and active employees explicitly assigned to that actor as reviewer.
do $scope$
declare original text; updated text;
begin
 original:=pg_get_functiondef('public.workspace_hr_snapshot_clocking_history(date,boolean)'::regprocedure);
 updated:=replace(original,
  'where can_manage or workspace_hr_reviews_employee(actor,m.user_id) or (u.attivo is not false and m.active and m.user_id=actor)',
  'where (p_config and admin) or (u.attivo is not false and m.active and (m.user_id=actor or workspace_hr_reviews_employee(actor,m.user_id)))');
 if updated=original then raise exception 'Unexpected HR employee visibility contract'; end if;
 original:=updated;
 updated:=replace(updated,'where can_manage or m=actor','where m=any(ids)');
 if updated=original then raise exception 'Unexpected HR shift visibility contract'; end if;
 original:=updated;
 updated:=replace(updated,'and (can_manage or user_id=actor)','and user_id=any(ids)');
 if updated=original then raise exception 'Unexpected HR attendance visibility contract'; end if;
 execute updated;

 -- A scoped manager cannot bypass the roster by submitting a different UUID.
 original:=pg_get_functiondef('public.workspace_hr_save_calendar_request(jsonb)'::regprocedure);
 updated:=replace(original,' if target is null or not exists',
 $guard$ if not workspace_user_is_admin() and target is distinct from actor and not workspace_hr_reviews_employee(actor,target) then
  raise exception 'Non sei responsabile di questo dipendente' using errcode='42501';
 end if;
 if target is null or not exists$guard$);
 if updated=original then raise exception 'Unexpected calendar editing visibility contract'; end if;
 execute updated;
end $scope$;

notify pgrst,'reload schema';
commit;

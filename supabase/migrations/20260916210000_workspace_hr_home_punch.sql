begin;
create function public.workspace_hr_punch_status() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor();
begin
  return jsonb_build_object('actor_id',actor,
    'member',exists(select 1 from workspace_hr_members where user_id=actor and active),
    'open',workspace_hr_open_session());
end $$;
revoke all on function public.workspace_hr_punch_status() from public,anon;
grant execute on function public.workspace_hr_punch_status() to authenticated;
notify pgrst, 'reload schema';
commit;

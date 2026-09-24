begin;

-- Keep the client contract executable: a deployment must fail rather than serving
-- an HR shell whose admin-absence RPC is missing or has another signature.
do $$
declare
  rpc regprocedure;
  argument_names text[];
begin
  rpc := to_regprocedure('public.workspace_hr_admin_request(jsonb)');
  if rpc is null then
    raise exception 'Required HR RPC public.workspace_hr_admin_request(jsonb) is not installed';
  end if;
  select proargnames into argument_names
    from pg_proc
   where oid = rpc::oid;
  if argument_names is distinct from array['p_data']::text[] then
    raise exception 'HR admin absence RPC signature mismatch: expected p_data jsonb';
  end if;
  if not has_function_privilege('authenticated', rpc, 'EXECUTE') then
    raise exception 'Authenticated role cannot execute public.workspace_hr_admin_request(jsonb)';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;

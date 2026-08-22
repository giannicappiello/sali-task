create or replace function public.reserve_workspace_production_confirmation(
  p_proposal_id bigint,
  p_external_id uuid
) returns table(mes_proposal_id integer, confirmation_external_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  update public.workspace_production_proposals
  set confirmation_external_id = coalesce(workspace_production_proposals.confirmation_external_id, p_external_id),
      updated_at = now()
  where id = p_proposal_id;
  if not found then raise exception 'OP Workspace non trovata.' using errcode = 'P0001'; end if;
  return query select p.mes_proposal_id, p.confirmation_external_id
    from public.workspace_production_proposals p where p.id = p_proposal_id;
end $$;

revoke all on function public.reserve_workspace_production_confirmation(bigint,uuid) from public, anon, authenticated;
grant execute on function public.reserve_workspace_production_confirmation(bigint,uuid) to service_role;

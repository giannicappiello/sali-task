begin;

-- Read-only evidence. A restored OCT, a new deletion generation, an incomplete
-- response or a pending job must never inherit a previous reconciliation.
create or replace function public.workspace_reconciled_oct_sources(p_order_ids uuid[])
returns table(order_id uuid, generation uuid, deleted_at timestamptz)
language sql stable security definer set search_path=public as $$
  select o.id,q.generation,q.deleted_at
  from public.ordini_testate o join public.workspace_oct_deletions q on q.order_id=o.id
  where o.id=any(p_order_ids) and o.mexal_eliminato_il is not null
    and o.mexal_mes_eliminato_il is not null and q.status='COMPLETED'
    and q.deleted_at=o.mexal_eliminato_il
    and q.mes_response->>'status'='DELETED'
    and q.mes_response->>'workspaceOctId'=o.id::text
    and coalesce(q.mes_response->'blockers','[]'::jsonb)='[]'::jsonb;
$$;
revoke all on function public.workspace_reconciled_oct_sources(uuid[]) from public,anon,authenticated;
grant execute on function public.workspace_reconciled_oct_sources(uuid[]) to service_role;

-- Keep historical request/item links; completed source retirement is not an
-- outstanding cancellation. This function is also used by confirmation triggers.
create or replace function public.workspace_rdp_has_deleted_oct(p_request_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.ordini_testate o
    where o.mexal_eliminato_il is not null and (
      exists(select 1 from public.workspace_production_requests r where r.id=p_request_id and r.ordine_id=o.id)
      or exists(select 1 from public.workspace_production_request_items i where i.production_request_id=p_request_id and i.ordine_id=o.id))
    and not exists(select 1 from public.workspace_reconciled_oct_sources(array[o.id])));
$$;
revoke all on function public.workspace_rdp_has_deleted_oct(uuid) from public,anon,authenticated;
grant execute on function public.workspace_rdp_has_deleted_oct(uuid) to service_role;

commit;

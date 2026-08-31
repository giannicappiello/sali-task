begin;

do $$
declare
  target_request_id uuid;
  target_external_id uuid;
begin
  select request.id, request.external_id
  into target_request_id, target_external_id
  from public.workspace_production_requests as request
  join public.ordini_testate as oct on oct.id = request.ordine_id
  where request.rdp_number = 15
    and request.contract_version = 3
    and upper(coalesce(request.workspace_status, request.stato, '')) = 'CANCELLED'
    and oct.mexal_sigla = 'OC'
    and oct.mexal_serie = 2
    and oct.mexal_numero = 427
  for update of request;

  if target_request_id is null then
    return;
  end if;

  if exists (
    select 1 from public.workspace_production_proposals
    where production_request_id = target_request_id
  ) or exists (
    select 1 from public.workspace_production_event_inbox
    where external_id = target_external_id
  ) or exists (
    select 1
    from public.workspace_v3_confirmation_sagas as saga
    join public.workspace_v3_previews as preview on preview.id = saga.preview_id
    where preview.production_request_id = target_request_id
  ) then
    raise exception 'RDP15_CLEANUP_BLOCKED: la richiesta presenta effetti produttivi o conferme';
  end if;

  delete from public.workspace_v3_preview_components
  where preview_id in (
    select id from public.workspace_v3_previews
    where production_request_id = target_request_id
  );

  delete from public.workspace_v3_preview_sources
  where preview_id in (
    select id from public.workspace_v3_previews
    where production_request_id = target_request_id
  );

  delete from public.workspace_v3_previews
  where production_request_id = target_request_id;

  delete from public.workspace_production_request_audit
  where production_request_id = target_request_id;

  update public.workspace_production_requests
  set demand_snapshot_id = null,
      sent_demand_snapshot_id = null
  where id = target_request_id;

  delete from public.workspace_production_requests
  where id = target_request_id;
end
$$;

commit;

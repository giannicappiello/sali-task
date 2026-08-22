create or replace function public.process_workspace_production_event(
  p_event_id uuid,
  p_external_id uuid,
  p_sequence bigint,
  p_event_type text,
  p_payload_hash text,
  p_payload jsonb
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_request public.workspace_production_requests%rowtype;
  v_existing_hash text;
  v_proposal jsonb;
begin
  select payload_hash into v_existing_hash from public.workspace_production_event_inbox where event_id = p_event_id;
  if found then
    if v_existing_hash <> p_payload_hash then
      raise exception 'EventId già usato con payload differente.' using errcode = 'P0001';
    end if;
    return 'duplicate';
  end if;

  select * into v_request from public.workspace_production_requests
  where external_id = p_external_id for update;
  if not found then raise exception 'RdP Workspace non trovata.' using errcode = 'P0001'; end if;

  insert into public.workspace_production_event_inbox(event_id, external_id, sequence, event_type, payload_hash, payload)
  values (p_event_id, p_external_id, p_sequence, p_event_type, p_payload_hash, p_payload);

  if p_sequence <= v_request.last_event_sequence then
    update public.workspace_production_event_inbox set processed_at = now() where event_id = p_event_id;
    return 'stale';
  end if;

  update public.workspace_production_requests set
    stato = coalesce(p_payload->>'status', stato),
    workspace_status = coalesce(p_payload->>'workspaceStatus', workspace_status),
    last_event_sequence = p_sequence,
    updated_at = now()
  where id = v_request.id;

  for v_proposal in select value from jsonb_array_elements(coalesce(p_payload->'proposals', '[]'::jsonb)) loop
    insert into public.workspace_production_proposals(
      production_request_id, mes_proposal_id, production_index, quantita, stato, material_status,
      expected_material_availability, mes_production_order_id, mes_production_order_number, updated_at)
    values (
      v_request.id, (v_proposal->>'id')::integer, (v_proposal->>'productionIndex')::integer,
      (v_proposal->>'quantity')::numeric, v_proposal->>'status', v_proposal->>'materialStatus',
      nullif(v_proposal->>'expectedMaterialAvailability','')::date,
      nullif(v_proposal->>'productionOrderId','')::integer,
      nullif(v_proposal->>'productionOrderNumber',''), now())
    on conflict (mes_proposal_id) do update set
      stato = excluded.stato, material_status = excluded.material_status,
      expected_material_availability = excluded.expected_material_availability,
      mes_production_order_id = excluded.mes_production_order_id,
      mes_production_order_number = excluded.mes_production_order_number, updated_at = now();
  end loop;

  update public.workspace_production_event_inbox set processed_at = now() where event_id = p_event_id;
  return 'processed';
end $$;

revoke all on function public.process_workspace_production_event(uuid,uuid,bigint,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.process_workspace_production_event(uuid,uuid,bigint,text,text,jsonb) to service_role;

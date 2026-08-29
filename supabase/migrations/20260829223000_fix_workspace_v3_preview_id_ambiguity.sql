-- Qualify preview component columns that collide with RETURNS TABLE output names.
create or replace function public.persist_workspace_v3_preview(
  p_external_id uuid,
  p_production_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_payload_hash text,
  p_status text,
  p_oct_revision integer,
  p_oct_hash text,
  p_bom_hash text,
  p_availability_version text,
  p_snapshot jsonb,
  p_correlation_id uuid,
  p_causation_id uuid,
  p_requested_by uuid,
  p_sources jsonb,
  p_components jsonb
) returns table(preview_id bigint,status text,row_version bigint,created boolean)
language plpgsql security definer set search_path=public as $$
declare
  v_preview public.workspace_v3_previews%rowtype;
  v_item jsonb;
  v_parent_id bigint;
begin
  select preview.* into v_preview
  from public.workspace_v3_previews as preview
  where preview.idempotency_key=p_idempotency_key;
  if found then
    if v_preview.payload_hash<>p_payload_hash then raise exception 'V3_PREVIEW_IDEMPOTENCY_CONFLICT'; end if;
    return query select v_preview.id,v_preview.status,v_preview.row_version,false;
    return;
  end if;
  if p_status not in ('READY','BLOCKED') or jsonb_typeof(p_sources)<>'array' or jsonb_typeof(p_components)<>'array'
  then raise exception 'INVALID_V3_PREVIEW'; end if;

  insert into public.workspace_v3_previews(external_id,production_request_id,preview_hash,idempotency_key,payload_hash,
    status,oct_revision,oct_hash,bom_hash,availability_version,snapshot,correlation_id,causation_id,requested_by)
  values(p_external_id,p_production_request_id,p_preview_hash,p_idempotency_key,p_payload_hash,p_status,p_oct_revision,
    p_oct_hash,p_bom_hash,p_availability_version,p_snapshot,p_correlation_id,p_causation_id,p_requested_by)
  returning * into v_preview;

  insert into public.workspace_v3_preview_sources(preview_id,order_id,order_line_id,bom_revision_id,
    finished_article_code,finished_quantity,unit_of_measure,oct_revision,oct_hash,bom_hash)
  select v_preview.id,x.order_id,x.order_line_id,x.bom_revision_id,x.finished_article_code,x.finished_quantity,
    x.unit_of_measure,x.oct_revision,x.oct_hash,x.bom_hash
  from jsonb_to_recordset(p_sources) as x(order_id uuid,order_line_id uuid,bom_revision_id bigint,
    finished_article_code text,finished_quantity numeric,unit_of_measure text,oct_revision integer,oct_hash text,bom_hash text);

  for v_item in select component.value from jsonb_array_elements(p_components) as component(value)
    where component.value->>'componentKind'<>'FORMULA_MATERIAL'
  loop
    insert into public.workspace_v3_preview_components(preview_id,bom_line_id,component_kind,article_code,
      unit_of_measure,required_quantity,on_hand_quantity,committed_quantity,incoming_quantity,uncovered_quantity,
      required_at,expected_available_at,calculation_owner,formula_code,formula_revision,formula_snapshot_hash,batch,station,
      filling,blocker_code,certified_payload)
    values(v_preview.id,(v_item->>'bomLineId')::bigint,v_item->>'componentKind',upper(v_item->>'articleCode'),
      upper(v_item->>'unitOfMeasure'),(v_item->>'requiredQuantity')::numeric,coalesce((v_item->>'onHandQuantity')::numeric,0),
      coalesce((v_item->>'committedQuantity')::numeric,0),coalesce((v_item->>'incomingQuantity')::numeric,0),
      coalesce((v_item->>'uncoveredQuantity')::numeric,0),(v_item->>'requiredAt')::timestamptz,(v_item->>'expectedAvailableAt')::timestamptz,
      v_item->>'calculationOwner',nullif(v_item->>'formulaCode',''),nullif((v_item->>'formulaRevision')::integer,0),
      nullif(v_item->>'formulaSnapshotHash',''),nullif(v_item->>'batch',''),nullif(v_item->>'station',''),
      nullif(v_item->>'filling',''),nullif(v_item->>'blockerCode',''),coalesce(v_item->'certifiedPayload','{}'::jsonb));
  end loop;

  for v_item in select component.value from jsonb_array_elements(p_components) as component(value)
    where component.value->>'componentKind'='FORMULA_MATERIAL'
  loop
    select preview_component.id into v_parent_id
    from public.workspace_v3_preview_components as preview_component
    where preview_component.preview_id=v_preview.id
      and preview_component.component_kind='FORMULA_COMPONENT'
      and preview_component.bom_line_id=(v_item->>'bomLineId')::bigint
      and preview_component.article_code=upper(v_item->>'parentArticleCode');
    if v_parent_id is null then raise exception 'V3_FORMULA_PARENT_NOT_FOUND'; end if;
    insert into public.workspace_v3_preview_components(preview_id,bom_line_id,component_kind,parent_component_id,
      article_code,unit_of_measure,required_quantity,on_hand_quantity,committed_quantity,incoming_quantity,
      uncovered_quantity,required_at,expected_available_at,calculation_owner,formula_code,formula_revision,
      formula_snapshot_hash,batch,station,filling,blocker_code,certified_payload)
    values(v_preview.id,(v_item->>'bomLineId')::bigint,'FORMULA_MATERIAL',v_parent_id,upper(v_item->>'articleCode'),
      upper(v_item->>'unitOfMeasure'),(v_item->>'requiredQuantity')::numeric,coalesce((v_item->>'onHandQuantity')::numeric,0),
      coalesce((v_item->>'committedQuantity')::numeric,0),coalesce((v_item->>'incomingQuantity')::numeric,0),
      coalesce((v_item->>'uncoveredQuantity')::numeric,0),(v_item->>'requiredAt')::timestamptz,(v_item->>'expectedAvailableAt')::timestamptz,'PROGREMES',
      nullif(v_item->>'formulaCode',''),nullif((v_item->>'formulaRevision')::integer,0),
      nullif(v_item->>'formulaSnapshotHash',''),nullif(v_item->>'batch',''),nullif(v_item->>'station',''),
      nullif(v_item->>'filling',''),nullif(v_item->>'blockerCode',''),coalesce(v_item->'certifiedPayload','{}'::jsonb));
  end loop;

  insert into public.workspace_v3_audit(aggregate_type,aggregate_id,action,actor_id,after_hash,payload,correlation_id,causation_id)
  values('V3_PREVIEW',v_preview.id::text,'PREVIEW_CAPTURED',coalesce(p_requested_by::text,'system'),p_preview_hash,p_snapshot,p_correlation_id,p_causation_id);
  return query select v_preview.id,v_preview.status,v_preview.row_version,true;
end $$;

revoke all on function public.persist_workspace_v3_preview(uuid,uuid,text,text,text,text,integer,text,text,text,jsonb,uuid,uuid,uuid,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.persist_workspace_v3_preview(uuid,uuid,text,text,text,text,integer,text,text,text,jsonb,uuid,uuid,uuid,jsonb,jsonb)
  to service_role;

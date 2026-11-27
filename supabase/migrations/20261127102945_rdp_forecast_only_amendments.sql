-- Preserve historical links; omit removed demand only with an explicit MES receipt.
-- Runs in the same transaction as the existing MES confirmation mirror.
-- No business records are changed by installing this migration.
create or replace function public.link_confirmed_rdp_appended_lines()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_preview public.workspace_v4_previews%rowtype;
  v_request public.workspace_production_requests%rowtype;
  v_item jsonb; v_line public.ordini_righe%rowtype;
  v_demand jsonb; v_hash text; v_snapshot_id bigint; v_index integer;
begin
  if new.status <> 'EXTENDED' then return new; end if;
  select * into strict v_preview from public.workspace_v4_previews where id=new.preview_id;
  select * into strict v_request from public.workspace_production_requests where id=v_preview.production_request_id for update;
  if v_request.contract_version<>4 or v_request.workspace_status='CANCELLED' then raise exception 'V5_APPEND_REQUEST_INVALID'; end if;
  v_demand := v_preview.snapshot->'commercialDemand';
  perform l.id from public.ordini_righe l
    join public.workspace_production_request_items i on i.ordine_riga_id=l.id
    where i.production_request_id=v_request.id order by l.id for update of l;
  if jsonb_typeof(v_demand->'items') is distinct from 'array' or jsonb_array_length(v_demand->'items')=0
     or jsonb_array_length(coalesce(new.mes_response->'forecastLines','[]'::jsonb))=0
     or (new.mes_response->>'productionCreated') is distinct from
       (jsonb_array_length(coalesce(new.mes_response->'preservedProductionLines','[]'::jsonb))>0)::text
     or jsonb_array_length(coalesce(new.mes_response->'productionOrders','[]'::jsonb))<>
       jsonb_array_length(coalesce(new.mes_response->'preservedProductionLines','[]'::jsonb)) then
    raise exception 'V5_APPEND_RECEIPT_INVALID';
  end if;
  if exists(select 1 from public.workspace_production_request_items i where i.production_request_id=v_request.id
      and not exists(select 1 from jsonb_array_elements(v_demand->'items') x where x->>'lineId'=i.ordine_riga_id::text)
      and not (coalesce(new.mes_response->'retiredCommercialLines','[]'::jsonb) ? i.ordine_riga_id::text
        and exists(select 1 from jsonb_array_elements(coalesce(v_demand->'retiredCommercialItems','[]'::jsonb)) x
          join public.ordini_righe l on l.id=i.ordine_riga_id
          where x->>'lineId'=i.ordine_riga_id::text and x->>'orderId'=i.ordine_id::text and l.mexal_attiva=false))
      and not exists(select 1 from jsonb_array_elements(coalesce(v_demand->'excludedCommercialItems','[]'::jsonb)) x
        join public.workspace_reconciled_oct_sources(array[i.ordine_id]) proof on proof.order_id=i.ordine_id
        where x->>'lineId'=i.ordine_riga_id::text and x->>'orderId'=i.ordine_id::text)) then
    raise exception 'V5_APPEND_REMOVED_LINE';
  end if;
  select coalesce(max(item_index),0) into v_index from public.workspace_production_request_items where production_request_id=v_request.id;
  for v_item in select value from jsonb_array_elements(v_demand->'items') loop
    if exists(select 1 from public.workspace_production_request_items where production_request_id=v_request.id and ordine_riga_id=(v_item->>'lineId')::uuid) then
      continue; -- Existing request links and MES payloads are immutable.
    end if;
    select * into strict v_line from public.ordini_righe where id=(v_item->>'lineId')::uuid for update;
    if v_line.ordine_id<>(v_item->>'orderId')::uuid or v_line.mexal_attiva=false or coalesce(v_line.riga_descrittiva,false)
       or upper(v_line.codice_articolo)<>upper(v_item->>'commercialArticleCode')
       or v_line.quantita<>(v_item->>'requestedQuantity')::numeric then raise exception 'V5_APPEND_LINE_CHANGED'; end if;
    if not exists(select 1 from public.workspace_production_request_items where production_request_id=v_request.id and ordine_id=v_line.ordine_id) then
      raise exception 'V5_APPEND_FOREIGN_ORDER';
    end if;
    if exists(select 1 from public.workspace_production_request_items i join public.workspace_production_requests r on r.id=i.production_request_id
      where i.ordine_riga_id=v_line.id and r.id<>v_request.id and coalesce(r.workspace_status,r.stato,'')<>'CANCELLED') then
      raise exception 'V5_ADDED_LINE_ALREADY_LINKED';
    end if;
    if not (coalesce(new.mes_response->'forecastLines','[]'::jsonb) ? (v_item->>'lineId')) then raise exception 'V5_APPEND_RECEIPT_LINE_MISSING'; end if;
    v_index := v_index+1;
    insert into public.workspace_production_request_items(production_request_id,ordine_id,ordine_riga_id,item_index,
      item_external_key,mexal_order_key,mexal_line_position,codice_articolo_commerciale,mapping_status,
      quantita_oct,unita_misura_oct,quantita_unita_produzione,unita_misura_produzione,conversione,data_consegna_richiesta)
    values(v_request.id,v_line.ordine_id,v_line.id,v_index,v_item->>'itemExternalKey',v_item->>'mexalOrderKey',
      (v_item->>'mexalLinePosition')::integer,v_item->>'commercialArticleCode','TO_RESOLVE_IN_MES',
      (v_item->>'requestedQuantity')::numeric,v_item->>'requestedUnitOfMeasure',(v_item->>'productionQuantity')::numeric,
      v_item->>'productionUnitOfMeasure',v_item->'conversion',nullif(v_item->>'requestedDeliveryDate','')::date);
  end loop;
  v_hash := encode(sha256(convert_to(v_demand::text,'UTF8')),'hex');
  insert into public.workspace_production_demand_snapshots(production_request_id,snapshot_hash,demand_hash,contract_version,
    order_count,item_count,snapshot)
  values(v_request.id,v_hash,v_hash,4,jsonb_array_length(v_demand->'orders'),jsonb_array_length(v_demand->'items'),v_demand)
  on conflict do nothing;
  select id into strict v_snapshot_id from public.workspace_production_demand_snapshots where production_request_id=v_request.id and snapshot_hash=v_hash;
  update public.workspace_production_requests set demand_snapshot_id=v_snapshot_id,updated_at=now() where id=v_request.id;
  return new;
end $$;
revoke all on function public.link_confirmed_rdp_appended_lines() from public,anon,authenticated;


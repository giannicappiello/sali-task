begin;

-- L'idempotenza resta univoca tra le RdP attive. Le RdP annullate conservano
-- la propria chiave e tutto il lineage, ma non impediscono una nuova generazione.
drop index if exists public.workspace_production_requests_idempotency_uniq;
alter table public.workspace_production_requests
  drop constraint if exists workspace_production_requests_ordine_riga_id_key;
create index if not exists workspace_production_requests_idempotency_history_idx
  on public.workspace_production_requests (idempotency_key, created_at desc);
create unique index if not exists workspace_production_requests_active_idempotency_uniq
  on public.workspace_production_requests (idempotency_key)
  where upper(coalesce(workspace_status, stato, '')) <> 'CANCELLED';
create unique index if not exists workspace_production_requests_active_first_line_uniq
  on public.workspace_production_requests (ordine_riga_id)
  where upper(coalesce(workspace_status, stato, '')) <> 'CANCELLED';

create or replace function public.record_workspace_production_demand(
  p_create_request boolean,
  p_idempotency_key text,
  p_demand_hash text,
  p_snapshot_hash text,
  p_snapshot jsonb,
  p_requested_by uuid default null
) returns table(
  request_id uuid,
  external_id uuid,
  snapshot_id bigint,
  snapshot_hash text,
  snapshot_captured_at timestamptz,
  reused boolean,
  attempt_count integer
)
language plpgsql security definer set search_path = public as $$
declare
  v_request public.workspace_production_requests%rowtype;
  v_snapshot public.workspace_production_demand_snapshots%rowtype;
  v_item jsonb;
  v_reused boolean := false;
begin
  if nullif(btrim(p_idempotency_key), '') is null or nullif(btrim(p_demand_hash), '') is null or
     nullif(btrim(p_snapshot_hash), '') is null then
    raise exception 'INVALID_DEMAND_IDENTITY';
  end if;
  if coalesce((p_snapshot->>'version')::integer, 0) <> 2 or
     p_snapshot->>'kind' <> 'MULTI_OCT_PRODUCTION_DEMAND' or
     jsonb_typeof(p_snapshot->'items') <> 'array' or
     jsonb_array_length(p_snapshot->'items') = 0 then
    raise exception 'INVALID_MULTI_OCT_DEMAND';
  end if;

  if p_create_request then
    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
    select * into v_request from public.workspace_production_requests
      where idempotency_key = p_idempotency_key
        and upper(coalesce(workspace_status, stato, '')) <> 'CANCELLED'
      order by created_at desc limit 1 for update;
    if found then
      if v_request.demand_hash is distinct from p_demand_hash then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      v_reused := true;
    else
      insert into public.workspace_production_requests (
        ordine_id, ordine_riga_id, idempotency_key, demand_hash,
        contract_version, request_kind, requested_by, stato, workspace_status
      ) values (
        ((p_snapshot->'items'->0)->>'orderId')::uuid,
        ((p_snapshot->'items'->0)->>'lineId')::uuid,
        p_idempotency_key, p_demand_hash,
        2, 'MULTI_OCT_PRODUCTION_DEMAND', p_requested_by, 'PRONTA', 'PRONTA'
      ) returning * into v_request;
    end if;
  end if;

  select demand_snapshot.* into v_snapshot
  from public.workspace_production_demand_snapshots as demand_snapshot
  where demand_snapshot.production_request_id is not distinct from v_request.id
    and demand_snapshot.snapshot_hash = p_snapshot_hash;
  if found then
    v_reused := true;
    update public.workspace_production_demand_snapshots
      set last_validated_at = now()
      where id = v_snapshot.id
      returning * into v_snapshot;
  else
    insert into public.workspace_production_demand_snapshots (
      production_request_id, snapshot_hash, demand_hash, contract_version,
      order_count, item_count, requested_by, snapshot
    ) values (
      v_request.id, p_snapshot_hash, p_demand_hash, 2,
      (p_snapshot->>'orderCount')::integer,
      (p_snapshot->>'itemCount')::integer,
      p_requested_by, p_snapshot
    ) returning * into v_snapshot;
  end if;

  if p_create_request then
    for v_item in select value from jsonb_array_elements(p_snapshot->'items') loop
      insert into public.workspace_production_request_items (
        production_request_id, ordine_id, ordine_riga_id, item_index,
        item_external_key, mexal_order_key, mexal_line_position,
        codice_articolo_commerciale, codice_articolo_produttivo, mapping_status,
        quantita_oct, unita_misura_oct, quantita_unita_produzione,
        unita_misura_produzione, conversione, data_consegna_richiesta
      ) values (
        v_request.id,
        (v_item->>'orderId')::uuid,
        (v_item->>'lineId')::uuid,
        (v_item->>'itemIndex')::integer,
        v_item->>'itemExternalKey',
        v_item->>'mexalOrderKey',
        nullif(v_item->>'mexalLinePosition', '')::integer,
        v_item->>'commercialArticleCode',
        nullif(v_item->>'productionArticleCode', ''),
        coalesce(nullif(v_item->>'mappingStatus', ''), 'TO_RESOLVE_IN_MES'),
        (v_item->>'requestedQuantity')::numeric,
        v_item->>'requestedUnitOfMeasure',
        (v_item->>'productionQuantity')::numeric,
        v_item->>'productionUnitOfMeasure',
        v_item->'conversion',
        nullif(v_item->>'requestedDeliveryDate', '')::date
      ) on conflict (production_request_id, ordine_riga_id) do nothing;
    end loop;

    update public.workspace_production_requests set
      demand_snapshot_id = v_snapshot.id,
      updated_at = now()
    where id = v_request.id
    returning * into v_request;
  end if;

  return query select v_request.id, v_request.external_id, v_snapshot.id,
    v_snapshot.snapshot_hash, v_snapshot.captured_at, v_reused,
    coalesce(v_request.attempt_count, 0);
end $$;

revoke all on function public.record_workspace_production_demand(boolean,text,text,text,jsonb,uuid)
  from public, anon, authenticated;
grant execute on function public.record_workspace_production_demand(boolean,text,text,text,jsonb,uuid)
  to service_role;

commit;

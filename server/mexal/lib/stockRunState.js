export const STOCK_RUN_STATE_VERSION = 2;
export const STOCK_RUN_STALE_MS = 30 * 60 * 1000;

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function normalizedText(value) {
  return String(value ?? "").trim();
}

export function stockUpdateDiagnostics(previousMetadata, operations = []) {
  const previous = previousMetadata?.stock_update_diagnostics || {};
  const productIds = new Set(Array.isArray(previous.updated_product_ids) ? previous.updated_product_ids.map(normalizedText).filter(Boolean) : []);
  const productCodes = new Set(Array.isArray(previous.updated_product_codes) ? previous.updated_product_codes.map(normalizedText).filter(Boolean) : []);
  const repeatedProductIds = new Set(Array.isArray(previous.repeated_product_ids) ? previous.repeated_product_ids.map(normalizedText).filter(Boolean) : []);
  const previousOperations = nonNegativeInteger(previous.update_operations_total);
  let batchOperations = 0;
  const batchProductIds = new Set();

  for (const operation of operations || []) {
    const id = normalizedText(operation?.id);
    const code = normalizedText(operation?.code).toUpperCase();
    if (!id) continue;
    batchOperations += 1;
    if (productIds.has(id) || batchProductIds.has(id)) repeatedProductIds.add(id);
    batchProductIds.add(id);
    productIds.add(id);
    if (code) productCodes.add(code);
  }

  const updateOperationsTotal = previousOperations + batchOperations;
  return {
    version: 1,
    update_operations_total: updateOperationsTotal,
    unique_product_ids_count: productIds.size,
    repeated_update_operations: Math.max(0, updateOperationsTotal - productIds.size),
    updated_product_ids: [...productIds],
    updated_product_codes: [...productCodes],
    repeated_product_ids: [...repeatedProductIds],
    last_batch_update_operations: batchOperations,
    last_batch_unique_product_ids: batchProductIds.size,
  };
}

export function stockRunState(run, { batchSize, total, now = Date.now() } = {}) {
  const metadata = run?.metadata && typeof run.metadata === "object" ? run.metadata : {};
  const version = nonNegativeInteger(metadata.stock_state_version);
  const processed = nonNegativeInteger(run?.processed);
  const nextOffset = version >= STOCK_RUN_STATE_VERSION
    ? Math.max(processed, nonNegativeInteger(metadata.next_offset, processed))
    : processed;
  const checkpointAt = metadata.checkpointed_at || run?.started_at || null;
  const checkpointMs = Date.parse(checkpointAt || "");

  return {
    version,
    nextOffset,
    processed,
    updated: nonNegativeInteger(run?.updated),
    skipped: nonNegativeInteger(run?.skipped),
    failed: nonNegativeInteger(run?.failed),
    batchSize: nonNegativeInteger(metadata.batch_size, nonNegativeInteger(batchSize, 1)) || 1,
    total: nonNegativeInteger(metadata.total, nonNegativeInteger(total)),
    checkpointAt,
    stale: Number.isFinite(checkpointMs) && now - checkpointMs >= STOCK_RUN_STALE_MS,
    legacy: version < STOCK_RUN_STATE_VERSION,
  };
}

export function stockBatchCheckpoint(run, batch, { total, batchSize, now = new Date().toISOString(), metadata: metadataPatch = {} } = {}) {
  const state = stockRunState(run, { total, batchSize, now: Date.parse(now) });
  const processed = state.nextOffset + nonNegativeInteger(batch?.processed);
  const metadata = {
    ...(run?.metadata || {}),
    ...metadataPatch,
    stock_state_version: STOCK_RUN_STATE_VERSION,
    batch_size: nonNegativeInteger(batchSize, state.batchSize) || state.batchSize,
    total: nonNegativeInteger(total, state.total),
    next_offset: processed,
    checkpointed_at: now,
    last_batch_offset: state.nextOffset,
    last_batch_processed: nonNegativeInteger(batch?.processed),
  };

  return {
    expectedProcessed: state.processed,
    values: {
      processed,
      updated: state.updated + nonNegativeInteger(batch?.updated),
      skipped: state.skipped + nonNegativeInteger(batch?.skipped),
      failed: state.failed + nonNegativeInteger(batch?.failed),
      metadata,
    },
  };
}

export function shouldReplayStockCheckpoint({ requestedOffset, resume, state }) {
  const requested = nonNegativeInteger(requestedOffset);
  return !resume && requested < state.nextOffset;
}

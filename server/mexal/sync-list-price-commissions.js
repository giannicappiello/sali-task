import {
  completeSyncRun,
  createSyncRun,
  failSyncRunUnlessClosed,
  getSyncRun,
  updateSyncRunProgress,
} from "../../api/mexal/lib/syncRuns.js";

const ENDPOINT = "/dati-generali/provvigioni-listini";
const STAGING_TABLE = "mexal_sync_payload_rows";
const DEFAULT_BATCH_SIZE = 250;
const STAGING_INSERT_SIZE = 500;
const text = (value) => String(value ?? "").trim();

export function extractListPriceCommissionRows(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [payload?.dati, payload?.records, payload?.items, payload?.data, payload?.risultati, payload?.results];
  return candidates.find(Array.isArray) || [];
}

export function normalizeListPriceCommission(row, synchronizedAt = new Date().toISOString()) {
  const categoriaCliente = Number(row?.cod_cat_cli);
  const categoriaProdotto = Number(row?.cod_cat_art);
  const percentuale = Number(row?.provvigione || 0);
  if (!Number.isInteger(categoriaCliente) || categoriaCliente <= 0) throw new Error("Categoria cliente non valida.");
  if (!Number.isInteger(categoriaProdotto) || categoriaProdotto <= 0) throw new Error("Categoria articolo non valida.");
  if (!Number.isFinite(percentuale) || percentuale < 0 || percentuale > 100) throw new Error("Percentuale provvigionale non valida.");
  const agente = text(row?.cod_agente) || null;
  const tipo = text(row?.tipo);
  const formula = text(row?.formula);
  return {
    categoria_cliente: categoriaCliente,
    categoria_prodotto: categoriaProdotto,
    codice_agente_mexal: agente,
    percentuale,
    attiva: percentuale > 0 && Boolean(tipo || formula),
    origine: "mexal_provvigioni_listini",
    tipo_provvigione_mexal: tipo || null,
    formula_mexal: formula || null,
    codice_condizione_agente_mexal: Number(row?.cod_cond_agente || 0),
    dati_mexal: row,
    sincronizzato_il: synchronizedAt,
    aggiornato_il: synchronizedAt,
  };
}

function comparable(row) {
  return JSON.stringify({
    percentuale: Number(row.percentuale),
    attiva: Boolean(row.attiva),
    tipo_provvigione_mexal: row.tipo_provvigione_mexal || null,
    formula_mexal: row.formula_mexal || null,
    codice_condizione_agente_mexal: Number(row.codice_condizione_agente_mexal || 0),
    dati_mexal: row.dati_mexal || {},
  });
}

async function saveOne(supabase, row) {
  const query = supabase
    .from("mexal_regole_provvigioni")
    .select("id,percentuale,attiva,tipo_provvigione_mexal,formula_mexal,codice_condizione_agente_mexal,dati_mexal")
    .eq("categoria_cliente", row.categoria_cliente)
    .eq("categoria_prodotto", row.categoria_prodotto);

  const { data: existing, error: readError } = row.codice_agente_mexal
    ? await query.eq("codice_agente_mexal", row.codice_agente_mexal).maybeSingle()
    : await query.is("codice_agente_mexal", null).maybeSingle();
  if (readError) throw readError;

  if (existing && comparable(existing) === comparable(row)) {
    const { error } = await supabase
      .from("mexal_regole_provvigioni")
      .update({ sincronizzato_il: row.sincronizzato_il, aggiornato_il: row.aggiornato_il })
      .eq("id", existing.id);
    if (error) throw error;
    return "unchanged";
  }

  if (existing) {
    const { error } = await supabase.from("mexal_regole_provvigioni").update(row).eq("id", existing.id);
    if (error) throw error;
    return "updated";
  }

  const { error } = await supabase.from("mexal_regole_provvigioni").insert(row);
  if (error) throw error;
  return "inserted";
}

function errorDetails(error, rawRow, rowIndex) {
  return {
    message: text(error?.message || error).slice(0, 500),
    code: text(error?.code).slice(0, 100) || null,
    details: text(error?.details).slice(0, 500) || null,
    hint: text(error?.hint).slice(0, 500) || null,
    row_index: rowIndex,
    row: rawRow,
  };
}

function progressMetadata({ previous = {}, total, processed, batchSize, currentBatch, totalBatches, phase, firstError }) {
  return {
    ...previous,
    endpoint: ENDPOINT,
    total,
    processed,
    batch_size: batchSize,
    current_batch: currentBatch,
    total_batches: totalBatches,
    progress_percent: total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 100,
    phase,
    first_error: previous.first_error || firstError || null,
    updated_at: new Date().toISOString(),
  };
}

async function clearStaging(supabase, runId) {
  const { error } = await supabase.from(STAGING_TABLE).delete().eq("run_id", runId);
  if (error) throw error;
}

async function stageRows(supabase, runId, rows) {
  for (let offset = 0; offset < rows.length; offset += STAGING_INSERT_SIZE) {
    const payload = rows.slice(offset, offset + STAGING_INSERT_SIZE).map((rawData, index) => ({
      run_id: runId,
      row_index: offset + index,
      raw_data: rawData,
    }));
    const { error } = await supabase.from(STAGING_TABLE).insert(payload);
    if (error) throw error;
  }
}

async function loadAllActiveKeys(supabase, runId) {
  const activeKeys = new Set();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(STAGING_TABLE)
      .select("row_index,raw_data")
      .eq("run_id", runId)
      .order("row_index", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    for (const item of data || []) {
      try {
        const normalized = normalizeListPriceCommission(item.raw_data);
        activeKeys.add(`${normalized.categoria_cliente}:${normalized.categoria_prodotto}:${normalized.codice_agente_mexal || ""}`);
      } catch {
        // Le righe non valide sono già conteggiate durante l'elaborazione.
      }
    }
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return activeKeys;
}

async function disableMissingRows(supabase, activeKeys) {
  let disabled = 0;
  const errors = [];
  const { data: mexalRows, error: mexalRowsError } = await supabase
    .from("mexal_regole_provvigioni")
    .select("id,categoria_cliente,categoria_prodotto,codice_agente_mexal,attiva")
    .eq("origine", "mexal_provvigioni_listini");
  if (mexalRowsError) throw mexalRowsError;

  for (const existing of mexalRows || []) {
    const key = `${existing.categoria_cliente}:${existing.categoria_prodotto}:${existing.codice_agente_mexal || ""}`;
    if (!activeKeys.has(key) && existing.attiva) {
      const { error } = await supabase
        .from("mexal_regole_provvigioni")
        .update({ attiva: false, aggiornato_il: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) errors.push({ id: existing.id, message: text(error.message).slice(0, 300) });
      else disabled += 1;
    }
  }
  return { disabled, errors };
}

export async function startListPriceCommissionsSync({
  mexal,
  supabase,
  source = "manual",
  batchSize = DEFAULT_BATCH_SIZE,
}) {
  let runId = null;
  try {
    const run = await createSyncRun(supabase, {
      syncType: "list_price_commissions",
      source,
      metadata: { endpoint: ENDPOINT, phase: "download" },
    });
    if (run.duplicate) {
      return { success: true, status: "running", duplicate: true, runId: run.id, run };
    }
    runId = run.id;

    const payload = await mexal.getJson(ENDPOINT);
    const rawRows = extractListPriceCommissionRows(payload);
    const total = rawRows.length;
    const safeBatchSize = Math.max(25, Math.min(500, Number(batchSize) || DEFAULT_BATCH_SIZE));
    const totalBatches = Math.max(1, Math.ceil(total / safeBatchSize));

    await clearStaging(supabase, runId);
    await stageRows(supabase, runId, rawRows);

    const metadata = progressMetadata({
      total,
      processed: 0,
      batchSize: safeBatchSize,
      currentBatch: 0,
      totalBatches,
      phase: "processing",
    });
    const updatedRun = await updateSyncRunProgress(supabase, runId, {
      processed: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      metadata,
    });

    return { success: true, status: "running", runId, run: updatedRun, total, batchSize: safeBatchSize };
  } catch (error) {
    if (runId) {
      await clearStaging(supabase, runId).catch(() => {});
      await failSyncRunUnlessClosed(supabase, runId, text(error?.message || error));
    }
    throw error;
  }
}

export async function processListPriceCommissionsBatch({ supabase, runId, now = () => new Date().toISOString() }) {
  const run = await getSyncRun(supabase, runId);
  if (!run) throw Object.assign(new Error("Run provvigioni listini non trovata."), { status: 404 });
  if (run.status !== "running") return { success: run.status === "completed", status: run.status, runId, run };

  const previousMetadata = run.metadata || {};
  const total = Number(previousMetadata.total || 0);
  const batchSize = Math.max(25, Math.min(500, Number(previousMetadata.batch_size) || DEFAULT_BATCH_SIZE));
  const totalBatches = Math.max(1, Number(previousMetadata.total_batches) || Math.ceil(total / batchSize));
  const startIndex = Number(run.processed || 0);

  const { data: stagedRows, error: stageError } = await supabase
    .from(STAGING_TABLE)
    .select("row_index,raw_data")
    .eq("run_id", runId)
    .gte("row_index", startIndex)
    .order("row_index", { ascending: true })
    .limit(batchSize);
  if (stageError) throw stageError;
  if ((!stagedRows || stagedRows.length === 0) && startIndex < total) {
    throw new Error("Dati temporanei della sincronizzazione non disponibili.");
  }

  const counters = {
    processed: startIndex,
    inserted: Number(run.inserted || 0),
    updated: Number(run.updated || 0),
    skipped: Number(run.skipped || 0),
    failed: Number(run.failed || 0),
  };
  let firstError = previousMetadata.first_error || null;

  for (const item of stagedRows || []) {
    try {
      const normalized = normalizeListPriceCommission(item.raw_data, now());
      const outcome = await saveOne(supabase, normalized);
      if (outcome === "inserted") counters.inserted += 1;
      else if (outcome === "updated") counters.updated += 1;
      else counters.skipped += 1;
    } catch (error) {
      counters.failed += 1;
      if (!firstError) firstError = errorDetails(error, item.raw_data, item.row_index);
    }
    counters.processed += 1;
  }

  const currentBatch = Math.min(totalBatches, Math.ceil(counters.processed / batchSize));
  const metadata = progressMetadata({
    previous: previousMetadata,
    total,
    processed: counters.processed,
    batchSize,
    currentBatch,
    totalBatches,
    phase: counters.processed >= total ? "finalizing" : "processing",
    firstError,
  });

  const progress = await updateSyncRunProgress(supabase, runId, { ...counters, metadata });
  if (!progress) {
    const stopped = await getSyncRun(supabase, runId);
    return { success: false, status: stopped?.status || "cancelled", cancelled: stopped?.status === "cancelled", runId, run: stopped };
  }

  if (counters.processed < total) {
    return { success: true, status: "running", runId, run: progress };
  }

  const latest = await getSyncRun(supabase, runId);
  if (!latest || latest.status !== "running") {
    return { success: false, status: latest?.status || "cancelled", cancelled: latest?.status === "cancelled", runId, run: latest };
  }

  const activeKeys = await loadAllActiveKeys(supabase, runId);
  const disabledResult = await disableMissingRows(supabase, activeKeys);
  counters.failed += disabledResult.errors.length;
  if (!firstError && disabledResult.errors[0]) firstError = disabledResult.errors[0];

  await completeSyncRun(supabase, runId, {
    ...counters,
    metadata: {
      ...progressMetadata({
        previous: metadata,
        total,
        processed: counters.processed,
        batchSize,
        currentBatch: totalBatches,
        totalBatches,
        phase: "completed",
        firstError,
      }),
      disabled: disabledResult.disabled,
    },
  });
  await clearStaging(supabase, runId).catch(() => {});
  const completedRun = await getSyncRun(supabase, runId);

  return {
    success: counters.failed === 0,
    status: "completed",
    runId,
    run: completedRun,
    letti_da_mexal: total,
    inseriti: counters.inserted,
    aggiornati: counters.updated,
    invariati: counters.skipped,
    disattivati: disabledResult.disabled,
    errori: counters.failed,
  };
}

export async function syncListPriceCommissions(options) {
  const started = await startListPriceCommissionsSync(options);
  let result = started;
  while (result.status === "running") {
    result = await processListPriceCommissionsBatch({ supabase: options.supabase, runId: result.runId, now: options.now });
  }
  return result;
}

export { ENDPOINT as LIST_PRICE_COMMISSIONS_ENDPOINT, STAGING_TABLE as LIST_PRICE_COMMISSIONS_STAGING_TABLE };

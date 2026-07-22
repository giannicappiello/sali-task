import { completeSyncRun, createSyncRun, failSyncRunUnlessClosed, getSyncRun, updateSyncRunProgress } from "../../api/mexal/lib/syncRuns.js";

const ENDPOINT = "/dati-generali/provvigioni-listini";
const DEFAULT_BATCH_SIZE = 100;
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
  const active = percentuale > 0 && Boolean(tipo || formula);
  return {
    categoria_cliente: categoriaCliente,
    categoria_prodotto: categoriaProdotto,
    codice_agente_mexal: agente,
    percentuale,
    attiva: active,
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
  const query = supabase.from("mexal_regole_provvigioni")
    .select("id,percentuale,attiva,tipo_provvigione_mexal,formula_mexal,codice_condizione_agente_mexal,dati_mexal")
    .eq("categoria_cliente", row.categoria_cliente)
    .eq("categoria_prodotto", row.categoria_prodotto);
  const { data: existing, error: readError } = row.codice_agente_mexal
    ? await query.eq("codice_agente_mexal", row.codice_agente_mexal).maybeSingle()
    : await query.is("codice_agente_mexal", null).maybeSingle();
  if (readError) throw readError;
  if (existing && comparable(existing) === comparable(row)) {
    const { error } = await supabase.from("mexal_regole_provvigioni").update({ sincronizzato_il: row.sincronizzato_il, aggiornato_il: row.aggiornato_il }).eq("id", existing.id);
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

async function disableMissingRows(supabase, activeKeys) {
  let disabled = 0;
  const errors = [];
  const { data: mexalRows, error: mexalRowsError } = await supabase.from("mexal_regole_provvigioni")
    .select("id,categoria_cliente,categoria_prodotto,codice_agente_mexal,attiva")
    .eq("origine", "mexal_provvigioni_listini");
  if (mexalRowsError) throw mexalRowsError;
  for (const existing of mexalRows || []) {
    const key = `${existing.categoria_cliente}:${existing.categoria_prodotto}:${existing.codice_agente_mexal || ""}`;
    if (!activeKeys.has(key) && existing.attiva) {
      const { error } = await supabase.from("mexal_regole_provvigioni").update({ attiva: false, aggiornato_il: new Date().toISOString() }).eq("id", existing.id);
      if (error) errors.push({ id: existing.id, message: text(error.message).slice(0, 300) });
      else disabled += 1;
    }
  }
  return { disabled, errors };
}

function progressMetadata({ total, processed, batchSize, currentBatch, totalBatches, phase }) {
  return {
    endpoint: ENDPOINT,
    total,
    processed,
    batch_size: batchSize,
    current_batch: currentBatch,
    total_batches: totalBatches,
    progress_percent: total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 100,
    phase,
    updated_at: new Date().toISOString(),
  };
}

export async function syncListPriceCommissions({ mexal, supabase, source = "manual", now = () => new Date().toISOString(), batchSize = DEFAULT_BATCH_SIZE }) {
  let runId = null;
  const counters = { processed: 0, inserted: 0, updated: 0, skipped: 0, failed: 0 };
  try {
    const run = await createSyncRun(supabase, { syncType: "list_price_commissions", source, metadata: { endpoint: ENDPOINT, phase: "download" } });
    if (run.duplicate) throw Object.assign(new Error("È già presente una sincronizzazione provvigioni listini in corso."), { status: 409, runId: run.id });
    runId = run.id;

    const payload = await mexal.getJson(ENDPOINT);
    const rawRows = extractListPriceCommissionRows(payload);
    const total = rawRows.length;
    const safeBatchSize = Math.max(10, Math.min(500, Number(batchSize) || DEFAULT_BATCH_SIZE));
    const totalBatches = Math.max(1, Math.ceil(total / safeBatchSize));
    const activeKeys = new Set();
    const errors = [];

    await updateSyncRunProgress(supabase, runId, {
      ...counters,
      metadata: progressMetadata({ total, processed: 0, batchSize: safeBatchSize, currentBatch: 0, totalBatches, phase: "processing" }),
    });

    for (let offset = 0; offset < total; offset += safeBatchSize) {
      const current = await getSyncRun(supabase, runId);
      if (!current || current.status !== "running") {
        return { success: false, cancelled: current?.status === "cancelled", status: current?.status || "cancelled", runId, letti_da_mexal: total, ...counters, errori: errors };
      }

      const batch = rawRows.slice(offset, offset + safeBatchSize);
      for (const rawRow of batch) {
        try {
          const normalized = normalizeListPriceCommission(rawRow, now());
          activeKeys.add(`${normalized.categoria_cliente}:${normalized.categoria_prodotto}:${normalized.codice_agente_mexal || ""}`);
          const outcome = await saveOne(supabase, normalized);
          if (outcome === "inserted") counters.inserted += 1;
          else if (outcome === "updated") counters.updated += 1;
          else counters.skipped += 1;
        } catch (error) {
          counters.failed += 1;
          errors.push({ message: text(error?.message || error).slice(0, 300), row: rawRow });
        }
        counters.processed += 1;
      }

      const currentBatch = Math.floor(offset / safeBatchSize) + 1;
      const progress = await updateSyncRunProgress(supabase, runId, {
        ...counters,
        metadata: progressMetadata({ total, processed: counters.processed, batchSize: safeBatchSize, currentBatch, totalBatches, phase: "processing" }),
      });
      if (!progress) {
        const stopped = await getSyncRun(supabase, runId);
        return { success: false, cancelled: stopped?.status === "cancelled", status: stopped?.status || "cancelled", runId, letti_da_mexal: total, ...counters, errori: errors };
      }
    }

    const current = await getSyncRun(supabase, runId);
    if (!current || current.status !== "running") {
      return { success: false, cancelled: current?.status === "cancelled", status: current?.status || "cancelled", runId, letti_da_mexal: total, ...counters, errori: errors };
    }

    const disabledResult = await disableMissingRows(supabase, activeKeys);
    counters.failed += disabledResult.errors.length;
    errors.push(...disabledResult.errors);
    await completeSyncRun(supabase, runId, {
      ...counters,
      metadata: { ...progressMetadata({ total, processed: counters.processed, batchSize: safeBatchSize, currentBatch: totalBatches, totalBatches, phase: "completed" }), disabled: disabledResult.disabled },
    });
    return { success: errors.length === 0, status: "completed", runId, letti_da_mexal: total, validi: total - counters.failed, inseriti: counters.inserted, aggiornati: counters.updated, invariati: counters.skipped, disattivati: disabledResult.disabled, errori: errors };
  } catch (error) {
    if (runId) await failSyncRunUnlessClosed(supabase, runId, text(error?.message || error), counters);
    throw error;
  }
}

export { ENDPOINT as LIST_PRICE_COMMISSIONS_ENDPOINT };
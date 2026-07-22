import { completeSyncRun, createSyncRun, failSyncRun } from "../../api/mexal/lib/syncRuns.js";

const ENDPOINT = "/dati-generali/provvigioni-listini";
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

export async function saveListPriceCommissions(supabase, rows) {
  const summary = { inserted: 0, updated: 0, unchanged: 0, disabled: 0, errors: [] };
  const activeKeys = new Set();
  for (const row of rows) {
    const key = `${row.categoria_cliente}:${row.categoria_prodotto}:${row.codice_agente_mexal || ""}`;
    activeKeys.add(key);
    try {
      const query = supabase.from("mexal_regole_provvigioni")
        .select("id,percentuale,attiva,tipo_provvigione_mexal,formula_mexal,codice_condizione_agente_mexal,dati_mexal")
        .eq("categoria_cliente", row.categoria_cliente)
        .eq("categoria_prodotto", row.categoria_prodotto);
      const { data: existing, error: readError } = row.codice_agente_mexal ? await query.eq("codice_agente_mexal", row.codice_agente_mexal).maybeSingle() : await query.is("codice_agente_mexal", null).maybeSingle();
      if (readError) throw readError;
      if (existing && comparable(existing) === comparable(row)) {
        const { error } = await supabase.from("mexal_regole_provvigioni").update({ sincronizzato_il: row.sincronizzato_il, aggiornato_il: row.aggiornato_il }).eq("id", existing.id);
        if (error) throw error;
        summary.unchanged += 1;
      } else if (existing) {
        const { error } = await supabase.from("mexal_regole_provvigioni").update(row).eq("id", existing.id);
        if (error) throw error;
        summary.updated += 1;
      } else {
        const { error } = await supabase.from("mexal_regole_provvigioni").insert(row);
        if (error) throw error;
        summary.inserted += 1;
      }
    } catch (error) {
      summary.errors.push({ categoria_cliente: row.categoria_cliente, categoria_prodotto: row.categoria_prodotto, message: text(error?.message || error).slice(0, 300) });
    }
  }

  const { data: mexalRows, error: mexalRowsError } = await supabase.from("mexal_regole_provvigioni")
    .select("id,categoria_cliente,categoria_prodotto,codice_agente_mexal,attiva")
    .eq("origine", "mexal_provvigioni_listini");
  if (mexalRowsError) throw mexalRowsError;
  for (const existing of mexalRows || []) {
    const key = `${existing.categoria_cliente}:${existing.categoria_prodotto}:${existing.codice_agente_mexal || ""}`;
    if (!activeKeys.has(key) && existing.attiva) {
      const { error } = await supabase.from("mexal_regole_provvigioni").update({ attiva: false, aggiornato_il: new Date().toISOString() }).eq("id", existing.id);
      if (error) summary.errors.push({ id: existing.id, message: text(error.message).slice(0, 300) });
      else summary.disabled += 1;
    }
  }
  return summary;
}

export async function syncListPriceCommissions({ mexal, supabase, source = "manual", now = () => new Date().toISOString() }) {
  let runId = null;
  try {
    const run = await createSyncRun(supabase, { syncType: "list_price_commissions", source, metadata: { endpoint: ENDPOINT } });
    if (run.duplicate) throw Object.assign(new Error("È già presente una sincronizzazione provvigioni listini in corso."), { status: 409 });
    runId = run.id;
    const payload = await mexal.getJson(ENDPOINT);
    const rawRows = extractListPriceCommissionRows(payload);
    const normalized = [];
    const normalizationErrors = [];
    for (const row of rawRows) {
      try { normalized.push(normalizeListPriceCommission(row, now())); }
      catch (error) { normalizationErrors.push({ message: text(error?.message || error).slice(0, 300), row }); }
    }
    const writes = await saveListPriceCommissions(supabase, normalized);
    const errors = [...normalizationErrors, ...writes.errors];
    await completeSyncRun(supabase, runId, { processed: rawRows.length, inserted: writes.inserted, updated: writes.updated, skipped: writes.unchanged, failed: errors.length });
    return { success: errors.length === 0, runId, letti_da_mexal: rawRows.length, validi: normalized.length, inseriti: writes.inserted, aggiornati: writes.updated, invariati: writes.unchanged, disattivati: writes.disabled, errori: errors };
  } catch (error) {
    if (runId) await failSyncRun(supabase, runId, text(error?.message || error));
    throw error;
  }
}

export { ENDPOINT as LIST_PRICE_COMMISSIONS_ENDPOINT };

import { buildMexalClient } from "./sync-products.js";
import {
  normalizeWarehouseReasonCode,
  warehouseReasonDescription,
} from "../../shared/mexalWarehouseReasons.js";
import {
  invoiceLines,
  isRequestedSalesDocument,
} from "./invoice-line-economics.js";

export { invoiceLines, isRequestedSalesDocument } from "./invoice-line-economics.js";

const PAGE_SIZE = 20;
const DETAIL_CONCURRENCY = 1;

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value) {
  if (value === null || value === undefined || text(value) === "") return null;
  const parsed = Number(text(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function date(value) {
  const raw = text(value).replace(/\D/g, "").slice(0, 8);
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : null;
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["dati", "records", "items", "data", "results"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function matrixFirst(value) {
  return Array.isArray(value) && Array.isArray(value[0])
    ? value[0][value[0].length - 1]
    : value;
}

function warehouseReason(detail) {
  const code = normalizeWarehouseReasonCode(matrixFirst(
    detail.id_causale
    ?? detail.codice_causale
    ?? detail.cod_causale
    ?? detail.causale,
  ));
  const apiDescription = text(matrixFirst(
    detail.descr_causale
    ?? detail.descrizione_causale
    ?? detail.causale_descrizione
    ?? detail.desc_causale,
  ));
  return {
    causale_magazzino_codice: code || null,
    causale_magazzino_descrizione: warehouseReasonDescription(code, apiDescription) || null,
  };
}

async function runWithConcurrency(items, limit, worker) {
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => consume()),
  );
}

async function lookupNames(supabase, invoices) {
  const clientCodes = [...new Set(invoices.map((item) => text(item.cod_conto)).filter(Boolean))];
  const agentCodes = [...new Set(invoices.map((item) => text(item.codice_agente)).filter(Boolean))];
  const [clientsResult, agentsResult] = await Promise.all([
    clientCodes.length
      ? supabase.from("ordini_clienti_cache").select("codice_cliente,ragione_sociale,codice_agente_mexal").in("codice_cliente", clientCodes)
      : { data: [], error: null },
    agentCodes.length
      ? supabase.from("mexal_agenti").select("codice,nome,cognome").in("codice", agentCodes)
      : { data: [], error: null },
  ]);
  if (clientsResult.error || agentsResult.error) throw clientsResult.error || agentsResult.error;
  return {
    clients: new Map((clientsResult.data || []).map((item) => [item.codice_cliente, item])),
    agents: new Map((agentsResult.data || []).map((item) => [
      item.codice,
      [item.nome, item.cognome].map(text).filter(Boolean).join(" "),
    ])),
  };
}

async function saveInvoice(supabase, summary, detail, names, now) {
  const sigla = text(detail.sigla || summary.sigla).toUpperCase();
  const codModulo = text(detail.cod_modulo || summary.cod_modulo).toUpperCase();
  const codiceCliente = text(detail.cod_conto || summary.cod_conto);
  const client = names.clients.get(codiceCliente);
  const codiceAgente = text(
    detail.codice_agente
    || summary.codice_agente
    || client?.codice_agente_mexal,
  );
  const totaleDocumento = number(matrixFirst(detail.tot_documento));
  const totaleIva = number(matrixFirst(detail.tot_iva));
  const header = {
    sigla,
    cod_modulo: codModulo,
    serie: number(detail.serie || summary.serie),
    numero: number(detail.numero || summary.numero),
    data_documento: date(detail.data_documento || summary.data_documento),
    codice_cliente: codiceCliente,
    ragione_sociale_cliente: client?.ragione_sociale || codiceCliente,
    codice_agente_mexal: codiceAgente || null,
    agente_nome: names.agents.get(codiceAgente) || codiceAgente || null,
    ...warehouseReason(detail),
    id_pagamento: nullableNumber(matrixFirst(detail.id_pagamento)),
    nota: text(matrixFirst(detail.nota)) || null,
    totale_imponibile: Math.round((totaleDocumento - totaleIva) * 10000) / 10000,
    totale_iva: totaleIva,
    totale_documento: totaleDocumento,
    dati_mexal: detail,
    sincronizzato_il: now,
    aggiornato_il: now,
  };
  const { data: saved, error } = await supabase
    .from("mexal_fatture_vendita")
    .upsert(header, { onConflict: "sigla,cod_modulo,serie,numero,codice_cliente" })
    .select("id")
    .single();
  if (error) throw error;

  const mappedLines = invoiceLines(detail).map((line) => ({ ...line, fattura_id: saved.id }));
  if (mappedLines.length) {
    const { error: lineError } = await supabase
      .from("mexal_fatture_vendita_righe")
      .upsert(mappedLines, { onConflict: "fattura_id,posizione" });
    if (lineError) throw lineError;
    const positions = mappedLines.map((line) => line.posizione);
    const { error: staleError } = await supabase
      .from("mexal_fatture_vendita_righe")
      .delete()
      .eq("fattura_id", saved.id)
      .not("posizione", "in", `(${positions.join(",")})`);
    if (staleError) throw staleError;
  }
  return mappedLines.length;
}

export async function syncSalesInvoicePage({
  supabase,
  mexal = buildMexalClient(),
  next,
} = {}) {
  let syncState = {};
  if (next === undefined) {
    const { data: state, error: stateError } = await supabase
      .from("mexal_fatture_sync_stato")
      .select("next_cursor,fte_trovate,pagine_vuote_dopo_fte")
      .eq("id", 1)
      .single();
    if (stateError) throw stateError;
    next = state?.next_cursor || null;
    syncState = state || {};
  }
  const params = new URLSearchParams({ max: String(PAGE_SIZE) });
  if (next) params.set("next", next);
  const collection = await mexal.getJson(`/documenti/movimenti-magazzino?${params}`);
  const candidates = rows(collection).filter(isRequestedSalesDocument);
  const names = await lookupNames(supabase, candidates);
  const now = new Date().toISOString();
  let lineCount = 0;
  const failures = [];

  await runWithConcurrency(candidates, DETAIL_CONCURRENCY, async (summary) => {
    const sigla = text(summary.sigla).toUpperCase();
    const codModulo = text(summary.cod_modulo).toUpperCase();
    try {
      const path = `/documenti/movimenti-magazzino/${encodeURIComponent(sigla)}+${number(summary.serie)}+${number(summary.numero)}+${encodeURIComponent(text(summary.cod_conto))}`;
      const detail = await mexal.getJson(path);
      lineCount += await saveInvoice(supabase, summary, detail, names, now);
    } catch (error) {
      failures.push({
        reference: `${sigla}${codModulo} ${summary.serie}/${summary.numero} ${summary.cod_conto}`,
        error: text(error?.message || error),
      });
    }
  });

  const foundFte = syncState.fte_trovate === true || candidates.length > 0;
  const emptyPagesAfterFte = foundFte && candidates.length === 0
    ? Number(syncState.pagine_vuote_dopo_fte || 0) + 1
    : 0;
  const completed = !collection?.next || emptyPagesAfterFte >= 3;
  if (!failures.length) {
    const stateValues = {
      next_cursor: completed ? null : collection.next,
      fte_trovate: completed ? false : foundFte,
      pagine_vuote_dopo_fte: completed ? 0 : emptyPagesAfterFte,
      aggiornato_il: now,
    };
    if (!next) stateValues.ciclo_iniziato_il = now;
    const { error: stateUpdateError } = await supabase
      .from("mexal_fatture_sync_stato")
      .update(stateValues)
      .eq("id", 1);
    if (stateUpdateError) throw stateUpdateError;
  }

  return {
    success: failures.length === 0,
    completed,
    status: completed ? "completed" : "running",
    next: collection?.next || null,
    processed: candidates.length,
    lines: lineCount,
    failures,
  };
}

export default async function salesInvoicesHandler(req, res) {
  try {
    const result = await syncSalesInvoicePage({
      supabase: req.supabase,
    });
    return res.status(result.failures.length ? 207 : 200).json(result);
  } catch (error) {
    return res.status(Number(error?.status || 500)).json({
      success: false,
      error: error?.message || "Importazione documenti FT e OCX non riuscita.",
    });
  }
}

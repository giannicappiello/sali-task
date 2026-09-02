import { createClient } from "@supabase/supabase-js";
import { buildMexalClient, verifyUser } from "./sync-products.js";
import {
  normalizeWarehouseReasonCode,
  warehouseReasonDescription,
} from "../../shared/mexalWarehouseReasons.js";

function required(name) { const value = String(globalThis.process?.env?.[name] || "").trim(); if (!value) throw new Error(`Variabile Vercel mancante: ${name}`); return value; }
function adminClient() { return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }); }
function referencePath(document) { return `/documenti/ordini-clienti/${encodeURIComponent(document.sigla || "OC")}+${encodeURIComponent(document.serie)}+${encodeURIComponent(document.numero)}`; }
function text(value) { return String(value ?? "").trim(); }
function matrixFirst(value) { return Array.isArray(value) && Array.isArray(value[0]) ? value[0][value[0].length - 1] : value; }
function warehouseReason(detail) {
  const code = normalizeWarehouseReasonCode(matrixFirst(detail?.id_causale ?? detail?.codice_causale ?? detail?.cod_causale ?? detail?.causale));
  const apiDescription = text(matrixFirst(detail?.descr_causale ?? detail?.descrizione_causale ?? detail?.causale_descrizione ?? detail?.desc_causale));
  return {
    causale_magazzino_codice: code || null,
    causale_magazzino_descrizione: warehouseReasonDescription(code, apiDescription) || null,
  };
}
function errorResponseText(error) {
  const body = error?.mexalResponse?.body;
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return body;
  try { return JSON.stringify(body); } catch { return String(body); }
}
export function isMissingMexalDocument(error) {
  const status = Number(error?.status || error?.mexalResponse?.status);
  const details = `${String(error?.message || "")} ${errorResponseText(error)}`;
  return status === 404 || status === 410 || /\b(404|410|1004)\b|non trovat[oa]|not found|risorsa specificata non.*trovat/i.test(details);
}
export function isOrderFullyMissingFromMexal(documents = []) {
  const persisted = documents.filter((document) => String(document?.numero || "").trim());
  return persisted.length > 0 && persisted.every((document) =>
    document.stato_operativo === "ANNULLATO" || document.presente_in_mexal === false
  );
}

async function runStatus(supabase, runId) {
  const { data, error } = await supabase.from("mexal_sync_runs").select("status").eq("id", runId).maybeSingle();
  if (error) throw error;
  return data?.status || null;
}

async function updateMissingParentOrders(supabase, orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (!ids.length) return 0;
  const { data, error } = await supabase
    .from("ordini_documenti_mexal")
    .select("ordine_id,numero,stato_operativo,presente_in_mexal")
    .in("ordine_id", ids)
    .not("numero", "is", null);
  if (error) throw error;
  const grouped = (data || []).reduce((map, document) => {
    const current = map.get(document.ordine_id) || [];
    current.push(document);
    map.set(document.ordine_id, current);
    return map;
  }, new Map());
  const missingOrderIds = ids.filter((orderId) => isOrderFullyMissingFromMexal(grouped.get(orderId) || []));
  if (!missingOrderIds.length) return 0;
  const { error: updateError } = await supabase
    .from("ordini_testate")
    .update({ stato_sincronizzazione: "annullato", sincronizzato_mexal_il: null })
    .in("id", missingOrderIds);
  if (updateError) throw updateError;
  return missingOrderIds.length;
}

export async function purgeEvictedOrderDocuments({ supabase, days }) {
  const cutoff = new Date(Date.now() - Number(days) * 86400000).toISOString();
  const { data, error } = await supabase.from("ordini_documenti_mexal").delete().eq("stato_operativo", "EVASO").lt("evaso_il", cutoff).select("id,modulo,tipo_documento");
  if (error) throw error;
  return { eliminati: data?.length || 0, ordiniph: (data || []).filter((row) => row.modulo === "ORDINIPH").length, ordinipr: (data || []).filter((row) => row.modulo === "ORDINIPR").length, cutoff };
}

export async function syncOrderDocuments({ supabase, mexal, origin = "manual" }) {
  const { data: documents, error } = await supabase.from("ordini_documenti_mexal").select("id,ordine_id,tipo_documento,modulo,sigla,serie,numero,anno,stato_operativo").not("numero", "is", null).neq("stato_operativo", "EVASO");
  if (error) throw error;
  const { data: run, error: runError } = await supabase.from("mexal_sync_runs").insert({ sync_type: "orders", status: "running", metadata: { source: origin, document_count: documents?.length || 0 } }).select("id").single();
  if (runError) throw runError;
  let open = 0; let missingFromMexal = 0; let failed = 0; let cancelled = false; const errors = [];
  for (const document of documents || []) {
    if (await runStatus(supabase, run.id) !== "running") {
      cancelled = true;
      break;
    }
    const now = new Date().toISOString();
    try {
      const detail = await mexal.getJson(referencePath(document));
      const requestedFields = document.tipo_documento === "OCX"
        ? { ...warehouseReason(detail), dati_mexal: detail }
        : {};
      const { error: updateError } = await supabase.from("ordini_documenti_mexal").update({ stato_operativo: "APERTO", presente_in_mexal: true, ultimo_sync_mexal: now, verificato_il: now, errore: null, aggiornato_il: now, ...requestedFields }).eq("id", document.id);
      if (updateError) throw updateError; open += 1;
    } catch (syncError) {
      if (isMissingMexalDocument(syncError)) {
        const { error: updateError } = await supabase.from("ordini_documenti_mexal").update({ stato_operativo: "ANNULLATO", presente_in_mexal: false, evaso_il: null, ultimo_sync_mexal: now, verificato_il: now, errore: null, aggiornato_il: now }).eq("id", document.id);
        if (updateError) throw updateError; missingFromMexal += 1;
      } else {
        failed += 1; errors.push({ id: document.id, message: syncError.message });
        await supabase.from("ordini_documenti_mexal").update({ stato_operativo: "ERRORE", ultimo_sync_mexal: now, errore: String(syncError.message || "Errore Mexal").slice(0, 500), aggiornato_il: now }).eq("id", document.id);
      }
    }
  }
  const parentOrdersMissingFromMexal = await updateMissingParentOrders(supabase, (documents || []).map((document) => document.ordine_id));
  cancelled = cancelled || await runStatus(supabase, run.id) !== "running";
  const { data: maintenance } = cancelled ? { data: null } : await supabase.from("mexal_ordini_manutenzione").select("*").eq("id", 1).maybeSingle();
  let cleanup = null;
  if (maintenance?.pulizia_automatica) {
    cleanup = await purgeEvictedOrderDocuments({ supabase, days: maintenance.giorni_conservazione_evasi });
    await supabase.from("mexal_ordini_manutenzione").update({ ultima_pulizia_il: new Date().toISOString(), ultimo_riepilogo: cleanup, aggiornato_il: new Date().toISOString() }).eq("id", 1);
  }
  const processed = open + missingFromMexal + failed;
  if (!cancelled) {
    const status = failed ? "completed_with_errors" : "completed";
    await supabase.from("mexal_sync_runs").update({ status, completed_at: new Date().toISOString(), processed, updated: open + missingFromMexal, failed, error_message: errors[0]?.message || null, metadata: { source: origin, aperti: open, assenti_mexal: missingFromMexal, ordini_assenti_mexal: parentOrdersMissingFromMexal, cleanup, errors } }).eq("id", run.id).eq("status", "running");
  }
  return { sync_run_id: run.id, processed, aperti: open, assenti_mexal: missingFromMexal, ordini_assenti_mexal: parentOrdersMissingFromMexal, failed, cleanup, cancelled };
}

export default async function handler(req, res) {
  const supabase = adminClient();
  try {
    await verifyUser(req, supabase, { allowOrdersUser: true });
    return res.status(200).json(await syncOrderDocuments({ supabase, mexal: buildMexalClient(), origin: req.body?.origin || "manual" }));
  } catch (error) { return res.status(error.status || 500).json({ error: error.message || "Sincronizzazione documenti ordine non riuscita." }); }
}

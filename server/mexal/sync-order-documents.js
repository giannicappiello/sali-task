import { createClient } from "@supabase/supabase-js";
import { buildMexalClient, verifyUser } from "./sync-products.js";

function required(name) { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`Variabile Vercel mancante: ${name}`); return value; }
function adminClient() { return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }); }
function referencePath(document) { return `/documenti/ordini-clienti/${encodeURIComponent(document.sigla || "OC")}+${encodeURIComponent(document.serie)}+${encodeURIComponent(document.numero)}`; }
function missing(error) { return Number(error?.status || error?.mexalResponse?.status) === 404 || /\b(404|1004)\b|non trovata|not found/i.test(String(error?.message || "")); }
async function runStatus(supabase, runId) {
  const { data, error } = await supabase.from("mexal_sync_runs").select("status").eq("id", runId).maybeSingle();
  if (error) throw error;
  return data?.status || null;
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
  let open = 0; let evicted = 0; let failed = 0; let cancelled = false; const errors = [];
  for (const document of documents || []) {
    if (await runStatus(supabase, run.id) !== "running") {
      cancelled = true;
      break;
    }
    const now = new Date().toISOString();
    try {
      await mexal.getJson(referencePath(document));
      const { error: updateError } = await supabase.from("ordini_documenti_mexal").update({ stato_operativo: "APERTO", presente_in_mexal: true, ultimo_sync_mexal: now, verificato_il: now, errore: null, aggiornato_il: now }).eq("id", document.id);
      if (updateError) throw updateError; open += 1;
    } catch (syncError) {
      if (missing(syncError)) {
        const { error: updateError } = await supabase.from("ordini_documenti_mexal").update({ stato_operativo: "EVASO", presente_in_mexal: false, evaso_il: now, ultimo_sync_mexal: now, verificato_il: now, errore: null, aggiornato_il: now }).eq("id", document.id);
        if (updateError) throw updateError; evicted += 1;
      } else {
        failed += 1; errors.push({ id: document.id, message: syncError.message });
        await supabase.from("ordini_documenti_mexal").update({ stato_operativo: "ERRORE", ultimo_sync_mexal: now, errore: String(syncError.message || "Errore Mexal").slice(0, 500), aggiornato_il: now }).eq("id", document.id);
      }
    }
  }
  cancelled = cancelled || await runStatus(supabase, run.id) !== "running";
  const { data: maintenance } = cancelled ? { data: null } : await supabase.from("mexal_ordini_manutenzione").select("*").eq("id", 1).maybeSingle();
  let cleanup = null;
  if (maintenance?.pulizia_automatica) {
    cleanup = await purgeEvictedOrderDocuments({ supabase, days: maintenance.giorni_conservazione_evasi });
    await supabase.from("mexal_ordini_manutenzione").update({ ultima_pulizia_il: new Date().toISOString(), ultimo_riepilogo: cleanup, aggiornato_il: new Date().toISOString() }).eq("id", 1);
  }
  const processed = open + evicted + failed;
  if (!cancelled) {
    const status = failed ? "completed_with_errors" : "completed";
    await supabase.from("mexal_sync_runs").update({ status, completed_at: new Date().toISOString(), processed, updated: open + evicted, failed, error_message: errors[0]?.message || null, metadata: { source: origin, aperti: open, evasi: evicted, cleanup, errors } }).eq("id", run.id).eq("status", "running");
  }
  return { sync_run_id: run.id, processed, aperti: open, evasi: evicted, failed, cleanup, cancelled };
}

export default async function handler(req, res) {
  const supabase = adminClient();
  try {
    await verifyUser(req, supabase, { allowOrdersUser: true });
    return res.status(200).json(await syncOrderDocuments({ supabase, mexal: buildMexalClient(), origin: req.body?.origin || "manual" }));
  } catch (error) { return res.status(error.status || 500).json({ error: error.message || "Sincronizzazione documenti ordine non riuscita." }); }
}

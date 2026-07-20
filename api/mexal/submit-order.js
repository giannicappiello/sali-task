import { createClient } from "@supabase/supabase-js";
import { buildMexalClient, verifyUser } from "../../server/mexal/sync-products.js";
import { ORDER_DOCUMENTS, buildMexalOrderDocument, classifyOrderLines, reconciliationFailure } from "../../server/mexal/order-documents.js";

function env(name) { return String(process.env[name] ?? "").trim(); }
function required(name) { const value = env(name); if (!value) throw new Error(`Variabile Vercel mancante: ${name}`); return value; }
function text(value) { return String(value ?? "").trim(); }
function supabaseAdmin() { return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } }); }
function documentOptions(config, kind) {
  const key = kind.toLowerCase();
  return {
    serie: config?.[`serie_${key}`] || 1,
    magazzino: config?.id_magazzino || 5,
    notaFormat: env("MEXAL_ORDER_NOTA_FORMAT") || "typed-array",
  };
}

function extractNumber(result) { return text(result?.numero || result?.numero_documento || result?.documento?.numero || result?.id || result?.risorsa); }

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  const admin = supabaseAdmin(); let orderId = null; let runId = null;
  try {
    await verifyUser(req, admin, { allowOrdersUser: true });
    orderId = text(req.body?.orderId); if (!orderId) return res.status(400).json({ error: "orderId obbligatorio." });
    const [{ data: order, error: orderError }, { data: lines, error: linesError }] = await Promise.all([admin.from("ordini_testate").select("*").eq("id", orderId).single(), admin.from("ordini_righe").select("*").eq("ordine_id", orderId).order("id")]);
    if (orderError) throw orderError; if (linesError) throw linesError; if (!lines?.length) throw new Error("Ordine senza righe.");
    const classified = classifyOrderLines(lines);
    console.info("Mexal order processing", { orderId, ociLines: classified.OCI.length, ocmLines: classified.OCM.length, ocxLines: classified.OCX.length });
    const requiredKinds = Object.keys(classified).filter((kind) => classified[kind].length);
    const done = new Set(requiredKinds.filter((kind) => text(order[`numero_${kind.toLowerCase()}`])));
    if (!req.body?.force && done.size === requiredKinds.length) return res.status(200).json({ skipped: true, message: "Ordine già sincronizzato.", documents: requiredKinds.map((kind) => ({ kind, numero: order[`numero_${kind.toLowerCase()}`] })) });
    const { data: run, error: runError } = await admin.from("mexal_sync_runs").insert({ sync_type: "orders", status: "running", metadata: { source: "submit-order", order_id: orderId } }).select("id").single(); if (runError) throw runError; runId = run.id;
    const { data: documentConfig, error: configError } = await admin.from("ordini_configurazione_documenti").select("serie_ocm,serie_ocx,serie_oci,id_magazzino").eq("id", 1).maybeSingle();
    if (configError) throw configError;
    await admin.from("ordini_testate").update({ stato_sincronizzazione: "in_corso", errore_sincronizzazione: null, ultimo_tentativo_sync: new Date().toISOString() }).eq("id", orderId);
    const mexal = buildMexalClient(); const documents = []; const failures = [];
    for (const kind of requiredKinds) {
      const { data: savedDocument, error: savedDocumentError } = await admin.from("ordini_documenti_mexal").select("*").eq("ordine_id", orderId).eq("tipo_documento", kind).maybeSingle();
      if (savedDocumentError) throw savedDocumentError;
      if (savedDocument?.numero) {
        try {
          const reconciled = await mexal.getJson(`/documenti/ordini-clienti/OC+${encodeURIComponent(savedDocument.serie)}+${encodeURIComponent(savedDocument.numero)}`);
          const outcome = reconciliationFailure(null, savedDocument.cod_modulo, reconciled);
          if (outcome) throw Object.assign(new Error(`Riconciliazione ${kind}: ${outcome.errore}`), { reconciliationState: outcome.stato });
          await admin.from("ordini_documenti_mexal").update({ stato: "reconciled", verificato_il: new Date().toISOString(), errore: null, aggiornato_il: new Date().toISOString() }).eq("ordine_id", orderId).eq("tipo_documento", kind);
          documents.push({ kind, numero: savedDocument.numero, reconciled: true }); continue;
        } catch (error) { const outcome = error.reconciliationState ? { stato: error.reconciliationState, errore: error.message } : reconciliationFailure(error, savedDocument.cod_modulo); failures.push({ kind, error: outcome?.errore || error.message }); await admin.from("ordini_documenti_mexal").update({ stato: outcome?.stato || "temporary_error", errore: outcome?.errore || error.message, tentativi: Number(savedDocument.tentativi || 0) + 1, aggiornato_il: new Date().toISOString() }).eq("ordine_id", orderId).eq("tipo_documento", kind); continue; }
      }
      if (done.has(kind)) { documents.push({ kind, numero: order[`numero_${kind.toLowerCase()}`], skipped: true }); continue; }
      const payload = buildMexalOrderDocument(order, kind, classified[kind], documentOptions(documentConfig, kind)); const startedAt = new Date().toISOString();
      try { const result = await mexal.postJson("/documenti/ordini-clienti", payload); const numero = extractNumber(result); const options = documentOptions(documentConfig, kind); documents.push({ kind, numero }); await admin.from("ordini_documenti_mexal").upsert({ ordine_id: orderId, tipo_documento: kind, stato: "created", sigla: "OC", serie: options.serie, numero, cod_modulo: ORDER_DOCUMENTS[kind]?.moduleCode, tentativi: Number(savedDocument?.tentativi || 0) + 1, errore: null, risposta: result, creato_il: new Date().toISOString(), aggiornato_il: new Date().toISOString() }); await admin.from("ordini_sync_mexal_log").insert({ ordine_id: orderId, tipo_documento: kind, stato: "successo", payload, risposta: result, iniziato_il: startedAt, completato_il: new Date().toISOString() }); }
      catch (error) { failures.push({ kind, error: error.message }); console.error("Mexal order document failed", { orderId, kind, error: error.message }); await admin.from("ordini_documenti_mexal").upsert({ ordine_id: orderId, tipo_documento: kind, stato: "failed", sigla: "OC", serie: documentOptions(documentConfig, kind).serie, cod_modulo: ORDER_DOCUMENTS[kind]?.moduleCode, tentativi: Number(savedDocument?.tentativi || 0) + 1, errore: error.message, aggiornato_il: new Date().toISOString() }); await admin.from("ordini_sync_mexal_log").insert({ ordine_id: orderId, tipo_documento: kind, stato: "errore", payload, errore: error.message, iniziato_il: startedAt, completato_il: new Date().toISOString() }); }
    }
    const updatedNumbers = Object.fromEntries(documents.map(({ kind, numero }) => [`numero_${kind.toLowerCase()}`, numero || order[`numero_${kind.toLowerCase()}`] || null]));
    const completed = failures.length === 0;
    await admin.from("ordini_testate").update({ stato: "confermato", stato_sincronizzazione: completed ? "completato" : "errore", sincronizzato_mexal_il: completed ? new Date().toISOString() : null, errore_sincronizzazione: failures.map((item) => `${item.kind}: ${item.error}`).join(" | ") || null, ...updatedNumbers }).eq("id", orderId);
    await admin.from("mexal_sync_runs").update({ status: completed ? "completed" : "completed_with_errors", completed_at: new Date().toISOString(), processed: 1, updated: documents.length, failed: failures.length, metadata: { source: "submit-order", order_id: orderId, documents, failures } }).eq("id", runId);
    console.info("Mexal order documents completed", { orderId, documents: documents.map(({ kind, numero }) => ({ kind, numero })), failures: failures.map(({ kind }) => kind) });
    if (!completed) return res.status(502).json({ error: "Uno o più documenti Mexal non sono stati creati.", documents, failures });
    return res.status(200).json({ success: true, documents, ...updatedNumbers });
  } catch (error) {
    if (runId) await admin.from("mexal_sync_runs").update({ status: "failed", completed_at: new Date().toISOString(), processed: orderId ? 1 : 0, failed: 1, error_message: text(error?.message).slice(0, 500) }).eq("id", runId);
    if (orderId) await admin.from("ordini_testate").update({ stato_sincronizzazione: "errore", errore_sincronizzazione: error.message, ultimo_tentativo_sync: new Date().toISOString() }).eq("id", orderId);
    console.error("Mexal order processing failed", { orderId, error: error?.message }); return res.status(error.status || 500).json({ error: error.message || "Errore sincronizzazione ordine." });
  }
}

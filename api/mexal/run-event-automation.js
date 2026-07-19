/* global process */
import { createClient } from "@supabase/supabase-js";

const ENDPOINTS = {
  clients: ["/api/mexal/sync-clients", { action: "sync" }],
  products: ["/api/mexal/sync-products", { action: "sync", offset: 0, batchSize: 8 }],
  stocks: ["/api/mexal/sync-products", { action: "sync-stock-it", offset: 0, batchSize: 12 }],
  commercial_conditions: ["/api/mexal/sync-commercial-conditions", { mode: "incremental", syncPayments: true }],
  document_series: ["/api/mexal/sync-document-series", {}],
};
const SCOPE_KEYS = { selected_customer: "customerId", selected_product: "productId", current_order: "orderId", current_user: "userId", current_warehouse: "warehouseId" };
function required(name) { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`Variabile Vercel mancante: ${name}`); return value; }
function baseUrl(req) { return `${String(req.headers["x-forwarded-proto"] || "https").split(",")[0]}://${req.headers["x-forwarded-host"] || req.headers.host}`; }
function applicable(automation, context) { return automation.scope === "global" || Boolean(context?.[SCOPE_KEYS[automation.scope]]); }

export async function runMexalEventAutomation({ admin, req, eventKey, context = {}, dryRun = false }) {
  const { data: automations, error } = await admin.from("mexal_event_automations").select("*").eq("event_key", eventKey).eq("enabled", true).order("execution_order", { ascending: true });
  if (error) throw error;
  const results = []; let interrupted = false; let previousFailed = false;
  for (const automation of automations || []) {
    if (!applicable(automation, context) || (previousFailed && !automation.run_if_previous_failed)) { results.push({ id: automation.id, syncType: automation.sync_type, skipped: true }); continue; }
    const endpoint = ENDPOINTS[automation.sync_type];
    if (!endpoint) { results.push({ id: automation.id, syncType: automation.sync_type, skipped: true, reason: "Handler non disponibile" }); continue; }
    if (dryRun) { results.push({ id: automation.id, syncType: automation.sync_type, success: true, dryRun: true }); continue; }
    try {
      const [path, body] = endpoint;
      const response = await fetch(`${baseUrl(req)}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: req.headers.authorization }, body: JSON.stringify({ ...body, origin: "event", context, eventKey }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) throw new Error(payload.error || `HTTP ${response.status}`);
      results.push({ id: automation.id, syncType: automation.sync_type, success: true, runId: payload.runId || payload.sync_run_id || null, data: payload });
    } catch (cause) {
      previousFailed = true;
      results.push({ id: automation.id, syncType: automation.sync_type, success: false, error: cause.message });
      if (automation.blocking && !automation.allow_continue_on_error) { interrupted = true; break; }
    }
  }
  return { success: !previousFailed || !interrupted, eventKey, executed: results.filter((item) => !item.skipped).length, skipped: results.filter((item) => item.skipped).length, failed: results.filter((item) => item.success === false).length, interrupted, results };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "Metodo non consentito." });
  try {
    const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (error || !user) return res.status(401).json({ success: false, error: "Sessione non valida." });
    const body = req.body || {};
    return res.status(200).json(await runMexalEventAutomation({ admin, req, eventKey: body.eventKey, context: { ...body.context, userId: user.id }, dryRun: Boolean(body.dryRun) }));
  } catch (error) { return res.status(500).json({ success: false, error: error.message || "Errore automazione Mexal." }); }
}

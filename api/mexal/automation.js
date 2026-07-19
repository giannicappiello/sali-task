import { createClient } from "@supabase/supabase-js";
import productsHandler from "../../server/mexal/sync-products.js";
import clientsHandler from "../../server/mexal/sync-clients.js";
import commercialConditionsHandler from "../../server/mexal/sync-commercial-conditions.js";
import documentSeriesHandler from "../../server/mexal/sync-document-series.js";
import stopHandler from "../../server/mexal/stop-sync-run.js";

const RUN_HANDLERS = Object.freeze({
  clients: clientsHandler,
  products: productsHandler,
  stocks: productsHandler,
  commercial_conditions: commercialConditionsHandler,
  document_series: documentSeriesHandler,
});

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

function requestBaseUrl(req) {
  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${host}`;
}

function runPayload(body, syncType) {
  const payload = { ...body, origin: body.origin || "manual" };
  delete payload.action;
  delete payload.syncType;
  delete payload.sync_type;
  if (syncType === "products") payload.action = "sync";
  if (syncType === "stocks") payload.action = "sync-stock-it";
  return payload;
}

async function requireAdmin(req) {
  const authorization = String(req.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) throw Object.assign(new Error("Sessione mancante."), { status: 401 });
  const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await admin.auth.getUser(authorization.slice(7));
  if (error || !user) throw Object.assign(new Error("Sessione non valida."), { status: 401 });
  const { data: profile, error: profileError } = await admin.from("utenti").select("id,attivo,ruoli(nome,livello)").eq("auth_user_id", user.id).maybeSingle();
  const role = String(profile?.ruoli?.nome || "").toLowerCase();
  if (profileError || !profile || profile.attivo === false || !(Number(profile.ruoli?.livello || 0) >= 80 || ["admin", "administrator", "amministratore", "super admin", "direzione"].includes(role))) {
    throw Object.assign(new Error("Operazione riservata agli amministratori."), { status: 403 });
  }
  return admin;
}

async function rulesGet(req, res) {
  const admin = await requireAdmin(req);
  const [schedules, events] = await Promise.all([
    admin.from("mexal_sync_schedules").select("*").order("execution_order", { ascending: true }),
    admin.from("mexal_event_automations").select("*").order("event_key").order("execution_order", { ascending: true }),
  ]);
  if (schedules.error) throw schedules.error;
  if (events.error) throw events.error;
  return res.status(200).json({ schedules: schedules.data || [], events: events.data || [] });
}

async function rulesSave(req, res, body) {
  const admin = await requireAdmin(req);
  const table = body.ruleType === "event" ? "mexal_event_automations" : "mexal_sync_schedules";
  const rule = body.rule && typeof body.rule === "object" ? body.rule : null;
  if (!rule) return res.status(400).json({ error: "Regola automazione non valida." });
  const { data, error } = await admin.from(table).upsert(rule).select().single();
  if (error) throw error;
  return res.status(200).json({ rule: data });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  const body = req.body || {};
  try {
    switch (body.action) {
      case "rules_get": return await rulesGet(req, res);
      case "rules_save": return await rulesSave(req, res, body);
      case "run_now": {
        const syncType = body.syncType || body.sync_type;
        const runHandler = RUN_HANDLERS[syncType];
        if (!runHandler) return res.status(400).json({ error: "Tipo sincronizzazione non supportato." });
        req.body = runPayload(body, syncType);
        return await runHandler(req, res);
      }
      case "stop":
        req.body = { runId: body.runId };
        return await stopHandler(req, res);
      case "sync_all":
      case "dispatch": {
        if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ ok: false, error: "Cron non autorizzato." });
        const response = await fetch(`${requestBaseUrl(req)}/api/cron/mexal-dispatcher`, { headers: { Authorization: req.headers.authorization } });
        const payload = await response.json().catch(() => ({}));
        return res.status(response.status).json(payload);
      }
      default: return res.status(400).json({ error: "Azione automazione Mexal non supportata." });
    }
  } catch (error) {
    return res.status(Number(error.status || 500)).json({ error: error.message || "Errore automazione Mexal." });
  }
}

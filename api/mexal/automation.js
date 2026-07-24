import { createClient } from "@supabase/supabase-js";
import productsHandler, { buildMexalClient } from "../../server/mexal/sync-products.js";
import clientsHandler from "../../server/mexal/sync-clients.js";
import agentsHandler from "../../server/mexal/sync-agents.js";
import commercialConditionsHandler from "../../server/mexal/sync-commercial-conditions.js";
import documentSeriesHandler from "../../server/mexal/sync-document-series.js";
import stopHandler from "../../server/mexal/stop-sync-run.js";
import { syncListPriceCommissions } from "../../server/mexal/sync-list-price-commissions.js";
import { agentsAccess } from "../../server/mexal/agents-access.js";
import orderDocumentsHandler, { purgeEvictedOrderDocuments } from "../../server/mexal/sync-order-documents.js";
import { requireAdmin } from "./lib/auth.js";
import { completeIdempotentSync, findRunningSync, reserveIdempotentSync } from "./lib/syncRuns.js";

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

async function listPriceCommissionsHandler(req, res) {
  const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await syncListPriceCommissions({
    mexal: buildMexalClient(),
    supabase: admin,
    source: req.body?.origin || "manual",
  });
  return res.status(200).json(result);
}

const RUN_HANDLERS = Object.freeze({
  clients: clientsHandler,
  agents: agentsHandler,
  products: productsHandler,
  stocks: productsHandler,
  commercial_conditions: commercialConditionsHandler,
  document_series: documentSeriesHandler,
  list_price_commissions: listPriceCommissionsHandler,
  orders: orderDocumentsHandler,
});

const SYNC_ALL_PHASES = Object.freeze([
  "clients",
  "agents",
  "commercial_conditions",
  "document_series",
  "products",
  "stocks",
  "list_price_commissions",
  "orders",
]);

function runPayload(body, syncType) {
  const payload = { ...body, origin: body.origin || "manual" };
  delete payload.action;
  delete payload.syncType;
  delete payload.sync_type;
  if (syncType === "products") payload.action = "sync";
  if (syncType === "stocks") payload.action = "sync-stock-it";
  return payload;
}

function createResponseCapture() {
  return {
    statusCode: 200,
    payload: undefined,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    send(payload) {
      if (typeof payload === "string") {
        try { this.payload = JSON.parse(payload); } catch { this.payload = payload; }
      } else {
        this.payload = payload;
      }
      return this;
    },
    setHeader() {},
  };
}

function errorDetails(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const { error, success, status, ok, ...details } = payload;
  return details;
}

function normalizeDetails(details) {
  if (!details) return {};
  if (typeof details === "object" && !Array.isArray(details)) return details;
  return { value: details };
}

function sendFailure(res, statusCode, phase, error, details = {}) {
  const safeStatus = Number.isInteger(Number(statusCode)) && Number(statusCode) >= 400 && Number(statusCode) <= 599
    ? Number(statusCode)
    : 500;
  return res.status(safeStatus).json({
    success: false,
    status: "failed",
    phase,
    error: error || "Errore automazione Mexal.",
    details: normalizeDetails(details),
  });
}

function sendRunning(res, phase, run) {
  return res.status(409).json({
    success: false,
    status: "running",
    phase,
    error: "Sincronizzazione già in esecuzione.",
    details: { syncRunId: String(run.id), startedAt: run.started_at },
  });
}

function sendSuccess(res, statusCode, payload = {}) {
  return res.status(statusCode).json({ ...payload, success: true, status: "completed" });
}

async function executeHandler(req, runHandler) {
  const response = createResponseCapture();
  let handlerError;
  try {
    await runHandler(req, response);
  } catch (error) {
    handlerError = error;
  }
  const payload = response.payload;
  const failed = Boolean(handlerError)
    || response.statusCode < 200
    || response.statusCode >= 300
    || payload?.success === false
    || payload?.ok === false;
  return { response, payload, handlerError, failed };
}

function sendHandlerResponse(res, phase, execution) {
  const { response, payload, handlerError, failed } = execution;
  if (!failed) return sendSuccess(res, response.statusCode, payload);
  const handlerStatus = Number(handlerError?.status);
  const responseStatus = Number(response.statusCode);
  const statusCode = handlerError
    ? (Number.isInteger(handlerStatus) && handlerStatus >= 400 && handlerStatus <= 599 ? handlerStatus : 500)
    : (Number.isInteger(responseStatus) && responseStatus >= 400 ? responseStatus : 500);
  return sendFailure(
    res,
    statusCode,
    phase,
    handlerError?.message || payload?.error || `Sincronizzazione ${phase} non riuscita.`,
    handlerError?.details || errorDetails(payload),
  );
}

async function createAdmin(req) {
  const createSupabase = () => createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authorization = String(req.headers.authorization || "");
  if (process.env.CRON_SECRET && authorization === `Bearer ${process.env.CRON_SECRET}`) {
    return { supabase: createSupabase(), authUserId: null };
  }
  const { supabase, authUserId } = await requireAdmin(req, createSupabase);
  return { supabase, authUserId };
}

async function startSync(req, res, body, syncType, runHandler, admin) {
  const running = await findRunningSync(admin.supabase, syncType);
  const isContinuation = ["products", "stocks"].includes(syncType)
    && body.syncRunId
    && running
    && String(body.syncRunId) === String(running.id);
  if (running && !isContinuation) return sendRunning(res, syncType, running);
  req.body = runPayload(body, syncType);
  return sendHandlerResponse(res, syncType, await executeHandler(req, runHandler));
}

async function syncAll(req, res, body, supabase) {
  const completedPhases = [];
  const results = [];
  for (const phase of SYNC_ALL_PHASES) {
    const running = await findRunningSync(supabase, phase);
    if (running) return sendRunning(res, phase, running);
    const phaseRequest = { ...req, body: runPayload(body, phase) };
    const execution = await executeHandler(phaseRequest, RUN_HANDLERS[phase]);
    const result = execution.payload || (execution.handlerError ? { error: execution.handlerError.message } : undefined);
    results.push({ phase, status: execution.failed ? "failed" : "completed", result });
    if (execution.failed) {
      return sendFailure(
        res,
        500,
        phase,
        execution.handlerError?.message || result?.error || `Sincronizzazione ${phase} non riuscita (HTTP ${execution.response.statusCode}).`,
        {
          processedActions: results.length,
          failedActions: 1,
          completedPhases,
          failedPhase: phase,
          results,
          handlerDetails: normalizeDetails(execution.handlerError?.details || errorDetails(result)),
        },
      );
    }
    completedPhases.push(phase);
  }
  return sendSuccess(res, 200, {
    processedActions: SYNC_ALL_PHASES.length,
    failedActions: 0,
    completedPhases,
    failedPhase: null,
    results,
    error: null,
  });
}

function idempotencyKey(body) {
  if (body.idempotencyKey == null) return null;
  const key = String(body.idempotencyKey).trim();
  if (!key || key.length > 255) throw Object.assign(new Error("idempotencyKey non valida."), { status: 400 });
  return key;
}

function syncRunId(payload) {
  const id = payload?.sync_run_id || payload?.runId || payload?.details?.syncRunId;
  return id == null ? null : Number(id);
}

async function executeIdempotently(req, res, body, syncType, operation) {
  const key = idempotencyKey(body);
  const admin = await createAdmin(req);
  if (!key) return operation(res, admin);

  const reservation = await reserveIdempotentSync(admin.supabase, {
    idempotencyKey: key,
    syncType,
    userId: admin.authUserId,
  });
  if (reservation.duplicate) {
    if (reservation.response) return res.status(200).json(reservation.response);
    return res.status(200).json({
      success: true,
      status: "running",
      syncRunId: reservation.sync_run_id == null ? null : String(reservation.sync_run_id),
    });
  }

  const captured = createResponseCapture();
  try {
    await operation(captured, admin);
  } catch (error) {
    sendFailure(captured, Number(error.status || 500), syncType, error.message || "Errore automazione Mexal.", error.details || {});
  }
  await completeIdempotentSync(admin.supabase, {
    idempotencyKey: key,
    syncType,
    userId: admin.authUserId,
    syncRunId: syncRunId(captured.payload),
    response: captured.payload,
  });
  return res.status(captured.statusCode).json(captured.payload);
}

async function rulesGet(req) {
  const admin = await createAdmin(req);
  const [schedules, events] = await Promise.all([
    admin.supabase.from("mexal_sync_schedules").select("*").order("execution_order", { ascending: true }),
    admin.supabase.from("mexal_event_automations").select("*").order("event_key").order("execution_order", { ascending: true }),
  ]);
  if (schedules.error) throw schedules.error;
  if (events.error) throw events.error;
  return { schedules: schedules.data || [], events: events.data || [] };
}

async function rulesSave(req, body) {
  const admin = await createAdmin(req);
  const table = body.ruleType === "event" ? "mexal_event_automations" : "mexal_sync_schedules";
  const rule = body.rule && typeof body.rule === "object" ? body.rule : null;
  if (!rule) throw Object.assign(new Error("Regola automazione non valida."), { status: 400 });
  const { data, error } = await admin.supabase.from(table).upsert(rule).select().single();
  if (error) throw error;
  return { rule: data };
}

async function maintenanceGet(req) {
  const admin = await createAdmin(req);
  const { data, error } = await admin.supabase.from("mexal_ordini_manutenzione").select("*").eq("id", 1).single();
  if (error) throw error;
  return { settings: data };
}

async function maintenanceSave(req, body) {
  const admin = await createAdmin(req);
  const days = Number(body.settings?.giorni_conservazione_evasi);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw Object.assign(new Error("I giorni di conservazione devono essere compresi tra 1 e 3650."), { status: 400 });
  const { data, error } = await admin.supabase.from("mexal_ordini_manutenzione").upsert({
    id: 1,
    giorni_conservazione_evasi: days,
    pulizia_automatica: Boolean(body.settings?.pulizia_automatica),
    aggiornato_il: new Date().toISOString(),
  }).select().single();
  if (error) throw error;
  return { settings: data };
}

async function maintenancePurge(req) {
  const admin = await createAdmin(req);
  const { data: settings, error } = await admin.supabase.from("mexal_ordini_manutenzione").select("*").eq("id", 1).single();
  if (error) throw error;
  const summary = await purgeEvictedOrderDocuments({ supabase: admin.supabase, days: settings.giorni_conservazione_evasi });
  const now = new Date().toISOString();
  await admin.supabase.from("mexal_ordini_manutenzione").update({ ultima_pulizia_il: now, ultimo_riepilogo: summary, aggiornato_il: now }).eq("id", 1);
  console.info("Mexal order Workspace cleanup", summary);
  return { summary };
}

export default async function handler(req, res) {
  const body = req.body || {};
  const phase = body.action || "request";
  if (req.method !== "POST") return sendFailure(res, 405, phase, "Metodo non consentito.");

  try {
    switch (body.action) {
      case "rules_get":
        return sendSuccess(res, 200, await rulesGet(req));
      case "rules_save":
        return sendSuccess(res, 200, await rulesSave(req, body));
      case "order_maintenance_get":
        return sendSuccess(res, 200, await maintenanceGet(req));
      case "order_maintenance_save":
        return sendSuccess(res, 200, await maintenanceSave(req, body));
      case "order_maintenance_purge":
        return sendSuccess(res, 200, await maintenancePurge(req));
      case "agents_access": {
        const admin = await createAdmin(req);
        return sendSuccess(res, 200, await agentsAccess({ supabase: admin.supabase, body }));
      }
      case "run_now": {
        const syncType = body.syncType || body.sync_type;
        const runHandler = RUN_HANDLERS[syncType];
        if (!runHandler) return sendFailure(res, 400, syncType || "run_now", "Tipo sincronizzazione non supportato.");
        return executeIdempotently(req, res, body, syncType, (response, admin) => (
          startSync(req, response, body, syncType, runHandler, admin)
        ));
      }
      case "stop":
        req.body = { runId: body.runId };
        return sendHandlerResponse(res, "stop", await executeHandler(req, stopHandler));
      case "sync_all":
        return executeIdempotently(req, res, body, "sync_all", (response, admin) => (
          syncAll(req, response, body, admin.supabase)
        ));
      case "dispatch": {
        if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
          return sendFailure(res, 401, "dispatch", "Cron non autorizzato.");
        }
        const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
        const host = req.headers["x-forwarded-host"] || req.headers.host;
        const response = await fetch(`${protocol}://${host}/api/cron/mexal-dispatcher`, {
          headers: { Authorization: req.headers.authorization },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success === false || payload?.ok === false) {
          return sendFailure(res, response.status, "dispatch", payload?.error || "Dispatch Mexal non riuscito.", errorDetails(payload));
        }
        return sendSuccess(res, response.status, payload);
      }
      default:
        return sendFailure(res, 400, phase, "Azione automazione Mexal non supportata.");
    }
  } catch (error) {
    return sendFailure(res, Number(error.status || 500), phase, error.message || "Errore automazione Mexal.", error.details || {});
  }
}

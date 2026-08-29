/* global process */
import { createClient } from "@supabase/supabase-js";
import productsHandler, { buildMexalClient } from "../../server/mexal/sync-products.js";
import clientsHandler from "../../server/mexal/sync-clients.js";
import agentsHandler from "../../server/mexal/sync-agents.js";
import commercialConditionsHandler from "../../server/mexal/sync-commercial-conditions.js";
import documentSeriesHandler from "../../server/mexal/sync-document-series.js";
import stopHandler from "../../server/mexal/stop-sync-run.js";
import {
  processListPriceCommissionsBatch,
  startListPriceCommissionsSync,
  syncListPriceCommissions,
} from "../../server/mexal/sync-list-price-commissions.js";
import { agentsAccess } from "../../server/mexal/agents-access.js";
import orderDocumentsHandler, { purgeEvictedOrderDocuments } from "../../server/mexal/sync-order-documents.js";
import salesInvoicesHandler from "../../server/mexal/sync-sales-invoices.js";
import productCategoriesHandler from "../../server/mexal/sync-product-categories.js";
import { requireAdmin, requirePermission } from "../../server/mexal/lib/auth.js";
import { completeIdempotentSync, findResumableSync, findRunningSync, reserveIdempotentSync, resumeFailedSync } from "../../server/mexal/lib/syncRuns.js";
import { dispatchWorkspaceNotifications } from "../../server/notifications/dispatch.js";
import documentApiHandler from "../../server/document-api.js";
import { consumeProgremesTicket, issueProgremesTicket, listUserProgremesSections } from "../../server/progremes-sso.js";
import { listProgremesIntegration, saveProgremesSyncConfig, stopProgremesModulesSync, syncProgremesModules } from "../../server/progremes-modules.js";
import { handleProgremesReadonlyRequest } from "../../server/progremes-readonly-api.js";
import { createProgremesClient } from "../../server/progremes-readonly-client.js";
import { createProgremesDiagnosticManager } from "../../server/progremes-diagnostics-client.js";
import { handleAIAssistant } from "../../server/ai/assistant.js";
import { handleCrmBrief } from "../../server/ai/crm-brief.js";
import { handleAIOrderDocument } from "../../server/ai/order-document.js";
import { cancelProductionRequest, confirmProductionProposal, handleProductionEvent, previewProductionRequest } from "../../server/progremes-production-api.js";
import { prepareProductionDemand } from "../../server/production-netting.js";
import { createOctOrdersRunHandler, precheckOctOrders } from "../../server/mexal/sync-oct-orders.js";
import { handleDigitalConnectionManager } from "../../server/crm/digital-connection-manager.js";
import { listProductionWorkbench, productionWorkbenchDetail } from "../../server/workspacemes-workbench.js";
import { productionGoLiveGates } from "../../server/workspace-production-gates.js";
import { effectiveWorkspaceDiagnostics } from "../../server/workspace-effective-diagnostics.js";
import { syncWorkspaceV3MexalContracts } from "../../server/mexal/sync-workspacemes-v3.js";
import { confirmWorkspaceV3, createWorkspaceV3Preview, workspaceV3FinishedArticleCodes } from "../../server/workspacemes-v3-api.js";
import { createWorkspaceV3PurchaseDocument } from "../../server/workspacemes-v3-purchasing.js";

async function dispatchMessageNotification(req, body) {
  const token = String(req.headers.authorization || "").trim().replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(new Error("Autenticazione richiesta."), { status: 401 });
  const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user?.id) throw Object.assign(new Error("Sessione non valida."), { status: 401 });
  const { data: profile, error: profileError } = await supabase.from("utenti").select("id").eq("auth_user_id", authData.user.id).single();
  if (profileError || !profile?.id) throw Object.assign(new Error("Profilo Workspace non valido."), { status: 403 });
  const messageId = String(body.messageId || "").trim();
  const conversationId = String(body.conversationId || "").trim();
  if (!messageId || !conversationId) throw Object.assign(new Error("Messaggio e conversazione obbligatori."), { status: 400 });
  const { data: message, error: messageError } = await supabase.from("chat_messaggi")
    .select("id,conversazione_id,mittente_id,created_at")
    .eq("id", messageId)
    .eq("conversazione_id", conversationId)
    .single();
  if (messageError || message?.mittente_id !== profile.id) throw Object.assign(new Error("Invio non autorizzato."), { status: 403 });
  const { data: notifications, error: notificationsError } = await supabase.from("notifiche")
    .select("id")
    .eq("chat_conversazione_id", conversationId)
    .neq("utente_id", profile.id)
    .gte("created_at", new Date(new Date(message.created_at).getTime() - 2000).toISOString());
  if (notificationsError) throw notificationsError;
  if (!(notifications || []).length) return { success: true, processed: 0, sent: 0, failed: 0 };
  return dispatchWorkspaceNotifications(supabase, {
    notificationIds: notifications.map((item) => item.id),
    generateDeadlines: false,
  });
}

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

const octOrdersHandler = createOctOrdersRunHandler({
  createMexalClient: buildMexalClient,
  createSupabaseClient: () => createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY")),
});

const RUN_HANDLERS = Object.freeze({
  clients: clientsHandler,
  agents: agentsHandler,
  products: productsHandler,
  product_categories: productCategoriesHandler,
  stocks: productsHandler,
  commercial_conditions: commercialConditionsHandler,
  document_series: documentSeriesHandler,
  list_price_commissions: listPriceCommissionsHandler,
  orders: orderDocumentsHandler,
  sales_invoices: salesInvoicesHandler,
  oct_orders: octOrdersHandler,
});

const SYNC_ALL_PHASES = Object.freeze([
  "clients",
  "agents",
  "commercial_conditions",
  "document_series",
  "products",
  "product_categories",
  "stocks",
  "list_price_commissions",
  "orders",
  "sales_invoices",
]);

function runPayload(body, syncType) {
  const payload = { ...body, origin: body.origin || "manual" };
  delete payload.action;
  delete payload.syncType;
  delete payload.sync_type;
  if (syncType === "products") payload.action = body.dryRun === true ? "test" : "sync";
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
  const details = { ...payload };
  delete details.error;
  delete details.success;
  delete details.status;
  delete details.ok;
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
  const status = payload.completed === false || payload.completato === false ? "running" : "completed";
  return res.status(statusCode).json({ ...payload, success: true, status });
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

async function createAdmin(req, permissionCode = null) {
  const createSupabase = () => createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authorization = String(req.headers.authorization || "");
  const internalSecrets = [process.env.CRON_SECRET, process.env.WORKER_SECRET].filter(Boolean);
  if (!permissionCode && internalSecrets.some((secret) => authorization === `Bearer ${secret}`)) {
    return { supabase: createSupabase(), authUserId: null };
  }
  const authorizationResult = permissionCode
    ? await requirePermission(req, createSupabase, permissionCode)
    : await requireAdmin(req, createSupabase);
  const { supabase, authUserId } = authorizationResult;
  return { supabase, authUserId };
}

async function startSync(req, res, body, syncType, runHandler, admin) {
  let running = await findRunningSync(admin.supabase, syncType);
  if (syncType === "stocks" && body.resume === true && running && !body.syncRunId) {
    body.syncRunId = Number(running.id);
  }
  if (syncType === "stocks" && body.resume === true && !running) {
    const failed = body.syncRunId
      ? await admin.supabase.from("mexal_sync_runs").select("id").eq("id", Number(body.syncRunId)).eq("sync_type", "stocks").eq("status", "failed").maybeSingle()
      : { data: await findResumableSync(admin.supabase, syncType), error: null };
    if (failed.error) throw failed.error;
    if (failed.data?.id) {
      running = await resumeFailedSync(admin.supabase, failed.data.id, { syncType });
      body.syncRunId = Number(running.id);
    }
  }
  const isContinuation = ["products", "stocks"].includes(syncType)
    && body.syncRunId
    && running
    && String(body.syncRunId) === String(running.id);
  if (running && !isContinuation) return sendRunning(res, syncType, running);
  req.body = runPayload(body, syncType);
  req.supabase = admin.supabase;
  return sendHandlerResponse(res, syncType, await executeHandler(req, runHandler));
}

function requireScheduledWorker(req) {
  const authorization = String(req.headers.authorization || "");
  const isCron = Boolean(process.env.CRON_SECRET) && authorization === `Bearer ${process.env.CRON_SECRET}`;
  const isWorker = Boolean(process.env.WORKER_SECRET) && authorization === `Bearer ${process.env.WORKER_SECRET}`;
  if (!isCron && !isWorker) {
    throw Object.assign(new Error("Worker non autorizzato."), { status: 401 });
  }
  if (isWorker) {
    if (!process.env.CRON_SECRET) {
      throw Object.assign(new Error("CRON_SECRET non configurato per gli handler Mexal."), { status: 500 });
    }
    req.headers = { ...req.headers, authorization: `Bearer ${process.env.CRON_SECRET}` };
  }
}

function stepCompleted(payload) {
  if (payload?.completed === false || payload?.completato === false || payload?.status === "running") return false;
  return payload?.completed === true || payload?.completato === true || payload?.status === "completed";
}

async function runScheduledStep(req, res, body, syncType, runHandler) {
  requireScheduledWorker(req);
  const admin = await createAdmin(req);

  if (syncType === "list_price_commissions") {
    let running = await findRunningSync(admin.supabase, syncType);
    if (!running) {
      const started = await startListPriceCommissionsSync({
        mexal: buildMexalClient(),
        supabase: admin.supabase,
        source: "cron",
        batchSize: body.batchSize,
      });
      running = started.run || (started.runId ? { id: started.runId, status: started.status } : null);
    }
    if (!running?.id) return sendFailure(res, 500, syncType, "Run provvigioni listini non disponibile.");
    const result = await processListPriceCommissionsBatch({ supabase: admin.supabase, runId: Number(running.id) });
    const completed = result.status === "completed";
    return res.status(200).json({
      ...result,
      success: true,
      status: completed ? "completed" : "running",
      completed,
      syncRunId: Number(running.id),
    });
  }

  const captured = createResponseCapture();
  await startSync(req, captured, body, syncType, runHandler, admin);
  if (captured.statusCode < 200 || captured.statusCode >= 300 || captured.payload?.success === false) {
    return res.status(captured.statusCode).json(captured.payload);
  }
  const completed = stepCompleted(captured.payload);
  return res.status(200).json({
    ...captured.payload,
    success: true,
    status: completed ? "completed" : "running",
    completed,
    syncRunId: syncRunId(captured.payload),
  });
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
  const admin = await createAdmin(req, `integrations.sync.${syncType}`);
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
  const admin = await createAdmin(req, "integrations.configure");
  const [schedules, events, heartbeat, cycle, jobs] = await Promise.all([
    admin.supabase.from("mexal_sync_schedules").select("*").order("execution_order", { ascending: true }),
    admin.supabase.from("mexal_event_automations").select("*").order("event_key").order("execution_order", { ascending: true }),
    admin.supabase.from("mexal_worker_heartbeat").select("*").eq("id", 1).maybeSingle(),
    admin.supabase.from("mexal_sync_cycles").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.supabase.from("mexal_sync_jobs").select("id,cycle_id,sync_type,execution_order,status,attempts,last_error,created_at,updated_at").order("created_at", { ascending: false }).limit(30),
  ]);
  if (schedules.error) throw schedules.error;
  if (events.error) throw events.error;
  if (heartbeat.error) throw heartbeat.error;
  if (cycle.error) throw cycle.error;
  if (jobs.error) throw jobs.error;
  return {
    schedules: schedules.data || [],
    events: events.data || [],
    diagnostics: { heartbeat: heartbeat.data || null, latestCycle: cycle.data || null, jobs: jobs.data || [] },
  };
}

async function rulesSave(req, body) {
  const admin = await createAdmin(req, "integrations.configure");
  const table = body.ruleType === "event" ? "mexal_event_automations" : "mexal_sync_schedules";
  const rule = body.rule && typeof body.rule === "object" ? body.rule : null;
  if (!rule) throw Object.assign(new Error("Regola automazione non valida."), { status: 400 });
  const normalizedRule = body.ruleType === "schedule"
    ? { ...rule, schedule_mode: "daily_vercel_hobby", hour: 23, minute: 0, frequency_minutes: null }
    : rule;
  const { data, error } = await admin.supabase.from(table).upsert(normalizedRule).select().single();
  if (error) throw error;
  return { rule: data };
}

async function maintenanceGet(req) {
  const admin = await createAdmin(req, "integrations.configure");
  const { data, error } = await admin.supabase.from("mexal_ordini_manutenzione").select("*").eq("id", 1).single();
  if (error) throw error;
  return { settings: data };
}

async function maintenanceSave(req, body) {
  const admin = await createAdmin(req, "integrations.configure");
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
  const admin = await createAdmin(req, "integrations.configure");
  const { data: settings, error } = await admin.supabase.from("mexal_ordini_manutenzione").select("*").eq("id", 1).single();
  if (error) throw error;
  const summary = await purgeEvictedOrderDocuments({ supabase: admin.supabase, days: settings.giorni_conservazione_evasi });
  const now = new Date().toISOString();
  await admin.supabase.from("mexal_ordini_manutenzione").update({ ultima_pulizia_il: now, ultimo_riepilogo: summary, aggiornato_il: now }).eq("id", 1);
  console.info("Mexal order Workspace cleanup", summary);
  return { summary };
}

export default async function handler(req, res) {
  if (req.query?.route === "crm-digital") {
    return handleDigitalConnectionManager(req, res);
  }
  if (req.query?.route === "progremes-production-events") {
    return handleProductionEvent(req, res);
  }
  if (req.query?.route === "progremes-readonly") {
    return handleProgremesReadonlyRequest(req, res);
  }
  if (req.query?.route === "ai") {
    try {
      const result = await handleAIAssistant(req);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      const status = Number(error?.status || 500);
      if (status >= 500) console.error("Assistente AI:", error);
      return res.status(status >= 400 && status <= 599 ? status : 500).json({
        success: false,
        error: error?.message || "Richiesta AI non riuscita.",
      });
    }
  }
  if (req.query?.route === "crm-ai") {
    try {
      const result = await handleCrmBrief(req);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      const status = Number(error?.status || 500);
      if (status >= 500) console.error("CRM AI Brief:", error);
      return res.status(status >= 400 && status <= 599 ? status : 500).json({
        success: false, error: error?.message || "Richiesta CRM AI non riuscita.",
      });
    }
  }
  const body = req.body || {};
  const phase = body.action || "request";
  if (req.method !== "POST") return sendFailure(res, 405, phase, "Metodo non consentito.");

  if (String(body.action || "").startsWith("document_")) {
    req.query = { ...(req.query || {}), action: String(body.action).slice("document_".length) };
    return documentApiHandler(req, res);
  }

  try {
    switch (body.action) {
      case "ai_order_capabilities":
      case "ai_order_document":
        return sendSuccess(res, 200, await handleAIOrderDocument(req));
      case "progremes_sso":
        return sendSuccess(res, 200, await issueProgremesTicket(req, body));
      case "progremes_user_sections":
        return sendSuccess(res, 200, await listUserProgremesSections(req));
      case "progremes_consume":
        return sendSuccess(res, 200, await consumeProgremesTicket(body));
      case "progremes_modules_list": {
        const admin = await createAdmin(req);
        return sendSuccess(res, 200, await listProgremesIntegration(req, admin.supabase));
      }
      case "workspacemes_v3_request": {
        const admin = await createAdmin(req, "rdp.create");
        const prepared = await prepareProductionDemand({
          admin: admin.supabase,
          orderIds: Array.isArray(body.orderIds) ? body.orderIds : [],
          lineIds: Array.isArray(body.lineIds) ? body.lineIds : [],
          expectedSnapshotId: body.snapshotId,
          requestedBy: admin.authUserId,
          mode: "create",
        });
        const requestId = prepared.request?.id;
        if (!requestId) throw Object.assign(new Error("Creazione RdP V3 non confermata."), { code: "V3_REQUEST_FAILED" });
        try {
          const finishedArticleCodes = await workspaceV3FinishedArticleCodes(admin.supabase, requestId);
          await syncWorkspaceV3MexalContracts({ mexal: buildMexalClient(), supabase: admin.supabase, finishedArticleCodes });
          const v3Preview = await createWorkspaceV3Preview({ admin: admin.supabase, requestId, requestedBy: admin.authUserId });
          await admin.supabase.from("workspace_production_requests").update({
            stato: v3Preview.status, workspace_status: v3Preview.status, last_error_code: null,
            last_response: { contractVersion: 3, previewId: v3Preview.preview_id, status: v3Preview.status },
            updated_at: new Date().toISOString(),
          }).eq("id", requestId);
          return sendSuccess(res, 200, { requestId, externalId: prepared.request.external_id, status: v3Preview.status, v3Preview });
        } catch (previewError) {
          await admin.supabase.from("workspace_production_requests").update({
            stato: "BLOCKED", workspace_status: "BLOCKED", last_error_code: previewError.code || "V3_PREVIEW_FAILED",
            last_response: { contractVersion: 3, error: previewError.message, code: previewError.code || "V3_PREVIEW_FAILED" },
            updated_at: new Date().toISOString(),
          }).eq("id", requestId);
          return sendSuccess(res, 200, { requestId, externalId: prepared.request.external_id, status: "BLOCKED",
            previewError: { code: previewError.code || "V3_PREVIEW_FAILED", message: previewError.message } });
        }
      }
      case "workspacemes_v3_precheck": {
        const admin = await createAdmin(req, "rdp.create");
        return previewProductionRequest(req, res, { admin: admin.supabase, requestedBy: admin.authUserId });
      }
      case "progremes_workbench_list": {
        const admin = await createAdmin(req, "rdp.view");
        const client = createProgremesClient();
        const [diagnostics, health] = await Promise.all([
          client.request("diagnostics").catch(() => []),
          client.request("diagnostics-health").catch(() => null),
        ]);
        const effectiveDiagnostics = await effectiveWorkspaceDiagnostics({ admin: admin.supabase, diagnostics });
        const workbench = await listProductionWorkbench({ admin: admin.supabase, diagnostics: effectiveDiagnostics });
        return sendSuccess(res, 200, { ...workbench, productionGates: productionGoLiveGates(health) });
      }
      case "progremes_workbench_detail": {
        const admin = await createAdmin(req, "rdp.view");
        const diagnostics = await createProgremesClient().request("diagnostics").catch(() => []);
        const effectiveDiagnostics = await effectiveWorkspaceDiagnostics({ admin: admin.supabase, diagnostics });
        return sendSuccess(res, 200, await productionWorkbenchDetail({
          admin: admin.supabase,
          orderId: body.orderId,
          requestId: body.requestId,
          diagnostics: effectiveDiagnostics,
        }));
      }
      case "progremes_diagnostic_action": {
        const admin = await createAdmin(req, "diagnostics.manage");
        const result = await createProgremesDiagnosticManager().changeStatus({
          diagnosticId: body.diagnosticId,
          action: body.diagnosticAction,
          reason: body.reason,
          actor: `workspace:${admin.authUserId || "service"}`,
        });
        return sendSuccess(res, 200, { diagnostic: result });
      }
      case "progremes_oct_refresh": {
        const admin = await createAdmin(req, "rdp.view");
        const { data, error } = await admin.supabase.rpc("enqueue_manual_workbench_oct_refresh", {
          p_requested_by: admin.authUserId,
          p_requested_at: new Date().toISOString(),
        });
        if (error) throw error;
        return sendSuccess(res, 202, { refresh: data });
      }
      case "progremes_oct_refresh_status": {
        const admin = await createAdmin(req, "rdp.view");
        const jobId = Number(body.jobId);
        if (!Number.isSafeInteger(jobId) || jobId < 1) {
          return sendFailure(res, 400, "progremes_oct_refresh_status", "Job OCT non valido.");
        }
        const { data, error } = await admin.supabase
          .from("mexal_sync_jobs")
          .select("id,cycle_id,status,attempts,started_at,completed_at,last_error,last_result")
          .eq("id", jobId)
          .eq("sync_type", "oct_orders")
          .maybeSingle();
        if (error) throw error;
        if (!data) return sendFailure(res, 404, "progremes_oct_refresh_status", "Job OCT Workbench non trovato.");
        return sendSuccess(res, 200, { refresh: data });
      }
      case "workspacemes_v3_mexal_sync": {
        const admin = await createAdmin(req, "integrations.sync.products");
        return sendSuccess(res, 200, await syncWorkspaceV3MexalContracts({
          mexal: buildMexalClient(),
          supabase: admin.supabase,
        }));
      }
      case "workspacemes_v3_preview": {
        const admin = await createAdmin(req, "rdp.create");
        const requestId = String(body.requestId || "").trim();
        try {
          const finishedArticleCodes = await workspaceV3FinishedArticleCodes(admin.supabase, requestId);
          // The V3 preview must use the current authoritative Mexal BOM and
          // supplier-order snapshots. Keeping this in the normal preview path
          // preserves the append-only preview semantics.
          await syncWorkspaceV3MexalContracts({
            mexal: buildMexalClient(),
            supabase: admin.supabase,
            finishedArticleCodes,
          });
          const v3Preview = await createWorkspaceV3Preview({
            admin: admin.supabase,
            requestId,
            requestedBy: admin.authUserId,
          });
          const { error: updateError } = await admin.supabase.from("workspace_production_requests").update({
            stato: v3Preview.status,
            workspace_status: v3Preview.status,
            last_error_code: null,
            last_response: { contractVersion: 3, previewId: v3Preview.preview_id, status: v3Preview.status },
            updated_at: new Date().toISOString(),
          }).eq("id", requestId);
          if (updateError) throw updateError;
          return sendSuccess(res, 200, {
            ...v3Preview,
            previewStatus: v3Preview.status,
          });
        } catch (previewError) {
          await admin.supabase.from("workspace_production_requests").update({
            stato: "BLOCKED",
            workspace_status: "BLOCKED",
            last_error_code: previewError.code || "V3_PREVIEW_FAILED",
            last_response: { contractVersion: 3, error: previewError.message, code: previewError.code || "V3_PREVIEW_FAILED" },
            updated_at: new Date().toISOString(),
          }).eq("id", requestId);
          throw previewError;
        }
      }
      case "workspacemes_v3_confirm": {
        const admin = await createAdmin(req, "rdp.decide");
        return sendSuccess(res, 200, await confirmWorkspaceV3({
          admin: admin.supabase,
          previewId: Number(body.previewId),
          reason: body.reason,
          requestedBy: admin.authUserId,
        }));
      }
      case "workspacemes_v3_purchase_document": {
        const admin = await createAdmin(req, "purchases.manage");
        return sendSuccess(res, 200, await createWorkspaceV3PurchaseDocument({
          admin: admin.supabase,
          input: body,
          actor: `workspace:${admin.authUserId || "service"}`,
        }));
      }
      case "progremes_production_confirm": {
        const admin = await createAdmin(req, "rdp.decide");
        return confirmProductionProposal(req, res, { admin: admin.supabase });
      }
      case "progremes_production_cancel": {
        const admin = await createAdmin(req, "rdp.cancel");
        req.body = { requestId: body.requestId, reason: body.reason };
        return cancelProductionRequest(req, res, { admin: admin.supabase, requestedBy: admin.authUserId });
      }
      case "progremes_modules_sync": {
        const admin = await createAdmin(req);
        return sendSuccess(res, 200, await syncProgremesModules(req, admin.supabase, "manuale"));
      }
      case "progremes_modules_stop": {
        const admin = await createAdmin(req);
        return sendSuccess(res, 200, await stopProgremesModulesSync(req, admin.supabase));
      }
      case "progremes_sync_config_save": {
        const admin = await createAdmin(req);
        return sendSuccess(res, 200, await saveProgremesSyncConfig(req, admin.supabase, body));
      }
      case "notification_public_key":
        return sendSuccess(res, 200, { publicKey: required("VAPID_PUBLIC_KEY") });
      case "notification_dispatch": {
        requireScheduledWorker(req);
        const admin = await createAdmin(req);
        return sendSuccess(res, 200, await dispatchWorkspaceNotifications(admin.supabase));
      }
      case "notification_dispatch_message":
        return sendSuccess(res, 200, await dispatchMessageNotification(req, body));
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
      case "oct_precheck": {
        const admin = await createAdmin(req, "integrations.sync.oct_orders");
        return sendSuccess(res, 200, await precheckOctOrders({
          mexal: buildMexalClient(),
          supabase: admin.supabase,
          env: process.env,
        }));
      }
      case "run_now": {
        const syncType = body.syncType || body.sync_type;
        const runHandler = RUN_HANDLERS[syncType];
        if (!runHandler) return sendFailure(res, 400, syncType || "run_now", "Tipo sincronizzazione non supportato.");
        return executeIdempotently(req, res, body, syncType, (response, admin) => (
          startSync(req, response, body, syncType, runHandler, admin)
        ));
      }
      case "run_scheduled_step": {
        const syncType = body.syncType || body.sync_type;
        const runHandler = RUN_HANDLERS[syncType];
        if (!runHandler) return sendFailure(res, 400, syncType || "run_scheduled_step", "Tipo sincronizzazione non supportato.");
        return runScheduledStep(req, res, body, syncType, runHandler);
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

import { createClient } from "@supabase/supabase-js";
import { cleanupStaleRuns } from "../mexal/lib/syncRuns.js";
import { buildMexalClient } from "../../server/mexal/sync-products.js";
import { syncListPriceCommissions } from "../../server/mexal/sync-list-price-commissions.js";

const DEFAULT_ORDER = ["clients", "agents", "products", "commercial_conditions", "document_series", "stocks", "list_price_commissions", "orders"];
const RESUMABLE_TYPES = new Set(["products", "stocks"]);
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const MAX_CONTINUATION_STEPS = 1000;

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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function callApi(fetchImpl, baseUrl, secret, path, body) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${secret}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let result = {};
  try { result = raw ? JSON.parse(raw) : {}; } catch { result = { error: raw }; }
  if (!response.ok || result.success === false || result.ok === false) {
    const error = new Error(result.error || `Sincronizzazione non riuscita (HTTP ${response.status}).`);
    error.status = response.status;
    error.details = result;
    throw error;
  }
  return result;
}

function isRetryable(error) {
  const status = Number(error?.status || 0);
  return !status || status === 408 || status === 425 || status === 429 || status >= 500;
}

async function callApiWithRetry(fetchImpl, baseUrl, secret, path, body) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await callApi(fetchImpl, baseUrl, secret, path, body);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_RETRIES) throw error;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

function endpointFor(syncType) {
  switch (syncType) {
    case "clients": return ["/api/mexal/automation", { action: "run_now", syncType: "clients", origin: "cron" }];
    case "agents": return ["/api/mexal/automation", { action: "run_now", syncType: "agents", origin: "cron" }];
    case "products": return ["/api/mexal/automation", { action: "run_now", syncType: "products", offset: 0, batchSize: 8, origin: "cron" }];
    case "commercial_conditions": return ["/api/mexal/automation", { action: "run_now", syncType: "commercial_conditions", mode: "incremental", syncPayments: true, origin: "cron" }];
    case "document_series": return ["/api/mexal/automation", { action: "run_now", syncType: "document_series", origin: "cron" }];
    case "stocks": return ["/api/mexal/automation", { action: "run_now", syncType: "stocks", offset: 0, batchSize: 12, origin: "cron" }];
    case "orders": return ["/api/mexal/automation", { action: "run_now", syncType: "orders", origin: "cron" }];
    default: return null;
  }
}

function runIdFrom(result) {
  const value = result?.sync_run_id ?? result?.runId ?? result?.details?.syncRunId;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function nextOffsetFrom(result) {
  const value = result?.prossimo_offset ?? result?.next_offset;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function executeResumableSync({ fetchImpl, baseUrl, secret, path, body, existingRun, onRunObserved }) {
  let payload = {
    ...body,
    offset: Math.max(0, Number(existingRun?.processed || body.offset || 0)),
    ...(existingRun?.id ? { syncRunId: Number(existingRun.id) } : {}),
  };
  let lastOffset = -1;
  let lastResult = null;

  for (let step = 0; step < MAX_CONTINUATION_STEPS; step += 1) {
    const result = await callApiWithRetry(fetchImpl, baseUrl, secret, path, payload);
    lastResult = result;
    const runId = runIdFrom(result) || Number(payload.syncRunId) || null;
    if (runId) await onRunObserved(runId);

    if (result?.completato === true || result?.completed === true) return result;

    const nextOffset = nextOffsetFrom(result);
    if (nextOffset === null) return result;
    if (nextOffset <= lastOffset || nextOffset <= Number(payload.offset || 0)) {
      throw new Error("La sincronizzazione non avanza: offset di ripresa non valido.");
    }

    lastOffset = Number(payload.offset || 0);
    payload = { ...payload, offset: nextOffset, ...(runId ? { syncRunId: runId } : {}) };
  }

  throw Object.assign(new Error("Sincronizzazione interrotta: superato il numero massimo di lotti."), { details: lastResult });
}

export async function dispatchSchedules({ schedules, hasRunningRun, execute, updateSchedule, recordScheduleResult = async () => {} }) {
  const executed = [];
  for (const schedule of schedules) {
    const sync_type = schedule.sync_type;
    const now = new Date().toISOString();
    try {
      const runningRun = await hasRunningRun(sync_type);
      if (runningRun && !RESUMABLE_TYPES.has(sync_type)) {
        const item = { sync_type, success: true, status: "skipped", error: "È già presente una sincronizzazione in corso per questo tipo." };
        await recordScheduleResult(schedule, item);
        await updateSchedule(schedule.id, { last_run_at: now, last_status: item.status, last_error: null, updated_at: now, next_run_at: null });
        executed.push(item);
        continue;
      }

      if (sync_type === "orders") {
        const item = { sync_type, success: true, status: "skipped", error: "Gli ordini vengono inviati dal modulo Ordini." };
        await recordScheduleResult(schedule, item);
        await updateSchedule(schedule.id, { last_run_at: now, last_status: item.status, last_error: null, updated_at: now, next_run_at: null });
        executed.push(item);
        continue;
      }

      await execute(sync_type, schedule, runningRun || null);
      const item = { sync_type, success: true, status: "completed", error: null };
      await updateSchedule(schedule.id, { last_run_at: now, last_status: item.status, last_error: null, updated_at: now, next_run_at: null });
      executed.push(item);
    } catch (error) {
      const item = { sync_type, success: false, status: "failed", error: error?.message || "Errore sconosciuto." };
      await updateSchedule(schedule.id, { last_run_at: now, last_status: item.status, last_error: item.error.slice(0, 1000), updated_at: now, next_run_at: null });
      executed.push(item);
    }
  }
  return { ok: executed.every((item) => item.success), executed };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: "Cron non autorizzato." });
  }
  try {
    const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
    await cleanupStaleRuns(admin);
    const { data: schedules, error } = await admin.from("mexal_sync_schedules").select("id,sync_type,enabled,schedule_mode,batch_size,execution_order").eq("enabled", true).order("execution_order", { ascending: true });
    if (error) throw error;
    const rank = new Map(DEFAULT_ORDER.map((type, index) => [type, index]));
    const ordered = [...(schedules || [])].sort((a, b) => Number(a.execution_order) - Number(b.execution_order) || (rank.get(a.sync_type) ?? 99) - (rank.get(b.sync_type) ?? 99));
    const summary = await dispatchSchedules({
      schedules: ordered,
      hasRunningRun: async (syncType) => {
        const { data, error: runError } = await admin.from("mexal_sync_runs").select("id,processed,source,context,metadata,started_at,status").eq("sync_type", syncType).eq("status", "running").order("started_at", { ascending: false }).limit(1).maybeSingle();
        if (runError) throw runError;
        return data || null;
      },
      execute: async (syncType, schedule, existingRun) => {
        if (syncType === "list_price_commissions") {
          return syncListPriceCommissions({ mexal: buildMexalClient(), supabase: admin, source: "cron" });
        }
        const endpoint = endpointFor(syncType);
        if (!endpoint) throw new Error(`Tipo sincronizzazione non supportato: ${syncType}`);
        const [path, body] = endpoint;
        const payload = body && { ...body, batchSize: schedule.batch_size || body.batchSize, context: { schedule_id: schedule.id } };
        const onRunObserved = async (runId) => {
          const { error: trackingError } = await admin.from("mexal_sync_runs").update({ source: "cron", context: { schedule_id: schedule.id } }).eq("id", runId);
          if (trackingError) throw trackingError;
        };
        if (RESUMABLE_TYPES.has(syncType)) {
          return executeResumableSync({ fetchImpl: fetch, baseUrl: requestBaseUrl(req), secret: process.env.CRON_SECRET, path, body: payload, existingRun, onRunObserved });
        }
        const result = await callApiWithRetry(fetch, requestBaseUrl(req), process.env.CRON_SECRET, path, payload);
        const runId = runIdFrom(result);
        if (runId) await onRunObserved(runId);
        return result;
      },
      updateSchedule: async (id, values) => {
        const { error: updateError } = await admin.from("mexal_sync_schedules").update(values).eq("id", id);
        if (updateError) throw updateError;
      },
      recordScheduleResult: async (schedule, item) => {
        const now = new Date().toISOString();
        const { error: runError } = await admin.from("mexal_sync_runs").insert({
          sync_type: schedule.sync_type,
          status: item.status,
          source: "cron",
          context: { schedule_id: schedule.id },
          started_at: now,
          completed_at: now,
          duration_ms: 0,
          error_message: item.error || null,
        });
        if (runError) throw runError;
      },
    });
    return res.status(200).json(summary);
  } catch (error) {
    return res.status(500).json({ ok: false, executed: [], error: error?.message || "Errore dispatcher Mexal." });
  }
}

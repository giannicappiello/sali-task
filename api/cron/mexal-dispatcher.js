import { createClient } from "@supabase/supabase-js";
import { cleanupStaleRuns } from "../mexal/lib/syncRuns.js";

const DEFAULT_ORDER = ["clients", "agents", "products", "commercial_conditions", "document_series", "stocks", "list_price_commissions", "orders"];
const RESUMABLE_TYPES = new Set(["products", "stocks", "list_price_commissions"]);
const SUPPORTED_SCHEDULE_MODES = new Set(["daily_vercel_hobby"]);
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const CONTINUATION_DELAY_MS = 10 * 60 * 1000;
const DAILY_DELAY_MS = 24 * 60 * 60 * 1000;
const FAILURE_RETRY_DELAY_MS = 60 * 60 * 1000;

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
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

function dateValue(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function selectDueSchedule(schedules, now = new Date()) {
  const nowTime = now.getTime();
  const rank = new Map(DEFAULT_ORDER.map((type, index) => [type, index]));
  return [...(schedules || [])]
    .filter((schedule) => schedule.enabled === true)
    .filter((schedule) => SUPPORTED_SCHEDULE_MODES.has(schedule.schedule_mode))
    .filter((schedule) => {
      const nextRun = dateValue(schedule.next_run_at);
      return nextRun === null || nextRun <= nowTime;
    })
    .sort((left, right) => {
      const leftNext = dateValue(left.next_run_at) ?? Number.NEGATIVE_INFINITY;
      const rightNext = dateValue(right.next_run_at) ?? Number.NEGATIVE_INFINITY;
      return leftNext - rightNext
        || Number(left.execution_order) - Number(right.execution_order)
        || (rank.get(left.sync_type) ?? 99) - (rank.get(right.sync_type) ?? 99);
    })[0] || null;
}

function nextRunAt(schedule, status, now) {
  if (status === "running") return new Date(now.getTime() + CONTINUATION_DELAY_MS).toISOString();
  if (status === "failed") return new Date(now.getTime() + FAILURE_RETRY_DELAY_MS).toISOString();
  switch (schedule.schedule_mode) {
    case "daily_vercel_hobby":
      return new Date(now.getTime() + DAILY_DELAY_MS).toISOString();
    default:
      throw new Error(`Modalità di schedulazione non supportata: ${schedule.schedule_mode}`);
  }
}

function runIdFrom(result) {
  const value = result?.sync_run_id ?? result?.syncRunId ?? result?.runId ?? result?.details?.syncRunId;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isCompleted(result) {
  if (result?.completed === false || result?.completato === false || result?.status === "running") return false;
  return result?.completed === true || result?.completato === true || result?.status === "completed";
}

export async function dispatchNextSchedule({
  schedules,
  now = () => new Date(),
  hasRunningRun,
  executeStep,
  updateSchedule,
  observeRun = async () => {},
}) {
  const startedAt = now();
  const schedule = selectDueSchedule(schedules, startedAt);
  if (!schedule) return { ok: true, status: "idle", selected: null };

  const timestamp = startedAt.toISOString();
  await updateSchedule(schedule.id, {
    last_run_at: timestamp,
    last_status: "running",
    last_error: null,
    updated_at: timestamp,
    next_run_at: new Date(startedAt.getTime() + CONTINUATION_DELAY_MS).toISOString(),
  });

  try {
    const existingRun = await hasRunningRun(schedule.sync_type);
    if (existingRun && !RESUMABLE_TYPES.has(schedule.sync_type)) {
      const item = {
        sync_type: schedule.sync_type,
        success: true,
        status: "running",
        completed: false,
        runId: Number(existingRun.id),
        error: null,
      };
      await updateSchedule(schedule.id, {
        last_status: item.status,
        last_error: null,
        updated_at: timestamp,
        next_run_at: nextRunAt(schedule, item.status, startedAt),
      });
      return { ok: true, status: item.status, selected: item };
    }

    const result = await executeStep(schedule.sync_type, schedule, existingRun || null);
    const runId = runIdFrom(result) || Number(existingRun?.id) || null;
    if (Number.isSafeInteger(runId)) await observeRun(runId, schedule);
    const completed = isCompleted(result);
    const status = completed ? "completed" : "running";
    const item = { sync_type: schedule.sync_type, success: true, status, completed, runId, result, error: null };
    await updateSchedule(schedule.id, {
      last_status: status,
      last_error: null,
      updated_at: timestamp,
      next_run_at: nextRunAt(schedule, status, startedAt),
    });
    return { ok: true, status, selected: item };
  } catch (error) {
    const message = error?.message || "Errore sconosciuto.";
    const item = { sync_type: schedule.sync_type, success: false, status: "failed", completed: false, error: message };
    await updateSchedule(schedule.id, {
      last_status: item.status,
      last_error: message.slice(0, 1000),
      updated_at: timestamp,
      next_run_at: nextRunAt(schedule, item.status, startedAt),
    });
    return { ok: false, status: item.status, selected: item };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Metodo non consentito." });
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: "Cron non autorizzato." });
  }
  try {
    const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
    await cleanupStaleRuns(admin);
    const { data: schedules, error } = await admin
      .from("mexal_sync_schedules")
      .select("id,sync_type,enabled,schedule_mode,batch_size,execution_order,next_run_at")
      .eq("enabled", true);
    if (error) throw error;

    const summary = await dispatchNextSchedule({
      schedules: schedules || [],
      hasRunningRun: async (syncType) => {
        const { data, error: runError } = await admin
          .from("mexal_sync_runs")
          .select("id,processed,source,context,metadata,started_at,status")
          .eq("sync_type", syncType)
          .eq("status", "running")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (runError) throw runError;
        return data || null;
      },
      executeStep: async (syncType, schedule, existingRun) => callApiWithRetry(
        fetch,
        requestBaseUrl(req),
        process.env.CRON_SECRET,
        "/api/mexal/automation",
        {
          action: "run_scheduled_step",
          syncType,
          origin: "cron",
          batchSize: schedule.batch_size || undefined,
          context: { schedule_id: schedule.id },
          ...(existingRun?.id ? { syncRunId: Number(existingRun.id) } : {}),
          ...(RESUMABLE_TYPES.has(syncType) ? { offset: Math.max(0, Number(existingRun?.processed || 0)) } : {}),
          ...(syncType === "commercial_conditions" ? { mode: "incremental", syncPayments: true } : {}),
        },
      ),
      updateSchedule: async (id, values) => {
        const { error: updateError } = await admin.from("mexal_sync_schedules").update(values).eq("id", id);
        if (updateError) throw updateError;
      },
      observeRun: async (runId, schedule) => {
        const { error: trackingError } = await admin
          .from("mexal_sync_runs")
          .update({ source: "cron", context: { schedule_id: schedule.id } })
          .eq("id", runId);
        if (trackingError) throw trackingError;
      },
    });
    return res.status(200).json(summary);
  } catch (error) {
    return res.status(500).json({ ok: false, status: "failed", selected: null, error: error?.message || "Errore dispatcher Mexal." });
  }
}

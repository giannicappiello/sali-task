import { createClient } from "@supabase/supabase-js";
import { runAutomaticProgremesModuleSync } from "../../server/progremes-modules.js";
import { runAutomaticTimeLearningScan } from "../../server/ai/assistant.js";

const TIMEZONE = "Europe/Rome";
const SCHEDULE_MODE = "daily_vercel_hobby";
const ACTIVE_JOB_STATUSES = ["queued", "leased", "running", "retry"];
const TERMINAL_CYCLE_STATUSES = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);

function required(name) {
  const value = String(globalThis.process?.env?.[name] || "").trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

export function isCronAuthorized(req, secret = globalThis.process?.env?.CRON_SECRET) {
  return Boolean(secret) && req?.headers?.authorization === `Bearer ${secret}`;
}

export function scheduledDateInTimezone(now = new Date(), timezone = TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date, days) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function businessDateInTimezone(now = new Date(), timezone = TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localDate = `${values.year}-${values.month}-${values.day}`;
  return Number(values.hour) >= 23 ? localDate : addDays(localDate, -1);
}

export function cycleKeyFor(scheduledDate, timezone = TIMEZONE) {
  return `daily-2300:${scheduledDate}:${timezone}`;
}

function dateValue(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function dueSchedules(schedules, now = new Date()) {
  const nowTime = now.getTime();
  return [...(schedules || [])]
    .filter((schedule) => schedule.enabled === true)
    .filter((schedule) => {
      const nextRun = dateValue(schedule.next_run_at);
      return nextRun === null || nextRun <= nowTime;
    })
    .sort((left, right) => (
      Number(left.execution_order) - Number(right.execution_order)
      || String(left.sync_type).localeCompare(String(right.sync_type))
      || Number(left.id) - Number(right.id)
    ));
}

function jobPayloadFor(schedule) {
  return {
    origin: "worker",
    schedule_mode: schedule.schedule_mode,
    configuration: schedule.sync_type === "commercial_conditions"
      ? { mode: "incremental", syncPayments: true }
      : {},
  };
}

export async function produceDailyMexalQueue({ store, now = new Date(), timezone = TIMEZONE, source = "vercel_cron" }) {
  const scheduledDate = businessDateInTimezone(now, timezone);
  const cycleKey = cycleKeyFor(scheduledDate, timezone);
  const { cycle, created } = await store.findOrCreateCycle({
    cycle_key: cycleKey,
    scheduled_date: scheduledDate,
    scheduled_for: now.toISOString(),
    timezone,
    source,
    status: "queued",
    metadata: { producer: source, businessDate: scheduledDate },
  });

  if (TERMINAL_CYCLE_STATUSES.has(cycle.status)) {
    const cycleJobs = await store.listCycleJobs(cycle.id);
    return {
      cycleId: cycle.id,
      cycleKey,
      created,
      jobsCreated: 0,
      existingJobs: cycleJobs.length,
      skippedActive: 0,
      unsupportedSchedules: 0,
      waiting: false,
    };
  }

  const schedules = dueSchedules(await store.listSchedules(), now);
  const supported = schedules.filter((schedule) => schedule.schedule_mode === SCHEDULE_MODE);
  const unsupportedSchedules = schedules.length - supported.length;
  const cycleJobs = await store.listCycleJobs(cycle.id);
  const existingScheduleIds = new Set(cycleJobs.map((job) => String(job.schedule_id)));
  const activeJobs = supported.length ? await store.listActiveJobs(supported.map((schedule) => schedule.id)) : [];
  const activeScheduleIds = new Set(activeJobs.map((job) => String(job.schedule_id)));

  const missingSchedules = [];
  let skippedActive = 0;
  for (const schedule of supported) {
    const scheduleId = String(schedule.id);
    if (existingScheduleIds.has(scheduleId)) continue;
    if (activeScheduleIds.has(scheduleId)) {
      skippedActive += 1;
      continue;
    }
    missingSchedules.push(schedule);
  }

  const jobs = missingSchedules.map((schedule) => ({
    cycle_id: cycle.id,
    schedule_id: schedule.id,
    sync_type: schedule.sync_type,
    execution_order: Number(schedule.execution_order),
    batch_size: schedule.batch_size || null,
    status: "queued",
    offset: 0,
    attempts: 0,
    max_attempts: 5,
    available_at: now.toISOString(),
    payload: jobPayloadFor(schedule),
  }));
  const insertedJobs = jobs.length ? await store.insertJobs(jobs) : [];
  const insertedScheduleIds = new Set(insertedJobs.map((job) => String(job.schedule_id)));
  const queuedSchedules = missingSchedules.filter((schedule) => insertedScheduleIds.has(String(schedule.id)));
  if (queuedSchedules.length) {
    await store.markSchedulesQueued(queuedSchedules.map((schedule) => schedule.id), now.toISOString());
  }

  const allCycleJobs = await store.listCycleJobs(cycle.id);
  const totalJobs = allCycleJobs.length;
  const waiting = totalJobs === 0 && skippedActive > 0;
  const cycleUpdate = {
    total_jobs: totalJobs,
    updated_at: now.toISOString(),
  };
  if (created) {
    cycleUpdate.status = totalJobs === 0 && !waiting ? "completed" : "queued";
    cycleUpdate.completed_at = totalJobs === 0 && !waiting ? now.toISOString() : null;
  }
  await store.updateCycle(cycle.id, cycleUpdate);

  return {
    cycleId: cycle.id,
    cycleKey,
    created,
    jobsCreated: insertedJobs.length,
    existingJobs: cycleJobs.length,
    skippedActive,
    unsupportedSchedules,
    waiting,
  };
}

// eslint-disable-next-line no-unused-vars
function createQueueStore(admin) {
  return {
    async findOrCreateCycle(values) {
      const inserted = await admin.from("mexal_sync_cycles").insert(values).select("*").single();
      if (!inserted.error) return { cycle: inserted.data, created: true };
      if (inserted.error.code !== "23505") throw inserted.error;
      const existing = await admin.from("mexal_sync_cycles").select("*").eq("cycle_key", values.cycle_key).single();
      if (existing.error) throw existing.error;
      return { cycle: existing.data, created: false };
    },

    async listSchedules() {
      const { data, error } = await admin
        .from("mexal_sync_schedules")
        .select("id,sync_type,enabled,schedule_mode,batch_size,execution_order,next_run_at")
        .eq("enabled", true)
        .or(`next_run_at.is.null,next_run_at.lte.${new Date().toISOString()}`)
        .order("execution_order", { ascending: true })
        .order("sync_type", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return data || [];
    },

    async listCycleJobs(cycleId) {
      const { data, error } = await admin
        .from("mexal_sync_jobs")
        .select("id,schedule_id,status")
        .eq("cycle_id", cycleId);
      if (error) throw error;
      return data || [];
    },

    async listActiveJobs(scheduleIds) {
      const { data, error } = await admin
        .from("mexal_sync_jobs")
        .select("id,cycle_id,schedule_id,status")
        .in("schedule_id", scheduleIds)
        .in("status", ACTIVE_JOB_STATUSES);
      if (error) throw error;
      return data || [];
    },

    async insertJobs(jobs) {
      const { data, error } = await admin
        .from("mexal_sync_jobs")
        .upsert(jobs, { onConflict: "cycle_id,schedule_id", ignoreDuplicates: true })
        .select("id,schedule_id");
      if (error) throw error;
      return data || [];
    },

    async markSchedulesQueued(scheduleIds, timestamp) {
      const { error } = await admin
        .from("mexal_sync_schedules")
        .update({ last_status: "queued", last_error: null, updated_at: timestamp })
        .in("id", scheduleIds);
      if (error) throw error;
    },

    async updateCycle(cycleId, values) {
      const { error } = await admin.from("mexal_sync_cycles").update(values).eq("id", cycleId);
      if (error) throw error;
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Metodo non consentito." });
  if (!isCronAuthorized(req)) return res.status(401).json({ error: "Cron non autorizzato." });

  let admin;
  const calledAt = new Date().toISOString();
  const triggerSource = "vercel_cron";
  try {
    admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await admin.from("mexal_worker_heartbeat").upsert({
      id: 1,
      last_called_at: calledAt,
      last_status: "dispatching",
      last_source: triggerSource,
      last_error: null,
      updated_at: calledAt,
    });
    const workerSecret = required("WORKER_SECRET");
    const { data, error } = await admin.rpc("create_daily_mexal_sync_cycle", {
      p_scheduled_for: calledAt,
      p_trigger_source: triggerSource,
    });
    if (error) throw error;
    await admin.from("mexal_worker_heartbeat").upsert({
      id: 1,
      last_status: data?.status || "dispatched",
      last_source: triggerSource,
      last_business_date: data?.businessDate || null,
      last_cycle_id: data?.cycleId || null,
      last_jobs_created: Number(data?.jobsCreated || 0),
      last_error: null,
      updated_at: new Date().toISOString(),
    });
    let progremes;
    try {
      progremes = await runAutomaticProgremesModuleSync(admin);
    } catch (progremesError) {
      progremes = { due: true, error: progremesError?.message || "Sincronizzazione ProgreMES non riuscita." };
    }
    let autoplanning;
    try {
      autoplanning = await runAutomaticTimeLearningScan();
    } catch (autoplanningError) {
      autoplanning = { error: autoplanningError?.message || "Verifica automatica dei tempi non riuscita." };
    }

    const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const workerRequest = fetch(`${protocol}://${host}/api/mexal/queue-worker`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workerSecret}`,
        "Content-Type": "application/json",
        "X-Worker-Source": "vercel-cron",
      },
      body: "{}",
    }).then(async (response) => ({ response, payload: await response.json().catch(() => ({})) }));
    const digitalRequest = fetch(`${protocol}://${host}/api/mexal/automation?route=crm-digital&action=dispatch`, {
      method: "GET",
      headers: {
        Authorization: req.headers.authorization,
        "X-Worker-Source": "vercel-cron",
      },
    }).then(async (response) => ({ response, payload: await response.json().catch(() => ({})) }));
    const [workerResult, digitalResult] = await Promise.allSettled([workerRequest, digitalRequest]);
    if (workerResult.status === "rejected") throw workerResult.reason;
    const { response: workerResponse, payload: workerPayload } = workerResult.value;
    if (!workerResponse.ok) {
      throw new Error(workerPayload?.error || `Avvio worker Mexal non riuscito (HTTP ${workerResponse.status}).`);
    }
    const digital = digitalResult.status === "fulfilled" && digitalResult.value.response.ok
      ? digitalResult.value.payload
      : {
          success: false,
          error: digitalResult.status === "rejected"
            ? digitalResult.reason?.message || "Dispatch Digital non raggiungibile."
            : digitalResult.value.payload?.error || `Dispatch Digital non riuscito (HTTP ${digitalResult.value.response.status}).`,
        };

    return res.status(200).json({ scheduler: data, worker: workerPayload, digital, progremes, autoplanning });
  } catch (error) {
    if (admin) {
      await admin.from("mexal_worker_heartbeat").upsert({
        id: 1,
        last_completed_at: new Date().toISOString(),
        last_status: "error",
        last_source: triggerSource,
        last_error: error?.message || "Creazione coda Mexal non riuscita.",
        updated_at: new Date().toISOString(),
      });
    }
    return res.status(500).json({ error: error?.message || "Creazione coda Mexal non riuscita." });
  }
}

import { synchronizeNas } from "../../server/private-documents-store.js";
import { createClient } from "@supabase/supabase-js";
import { runAutomaticDocumentSync } from "../../server/document-api.js";
import { checkAndRecordInfrastructureHealth } from "../../server/infrastructure-health.js";
import { waitUntil } from "@vercel/functions";
import { wakeMexalWorker } from "../../server/mexal/worker-wakeup.js";

const LEASE_SECONDS = 300;
const MAX_WORKER_DURATION_MS = 235000;
const MAX_STEPS_PER_CALL = 30;

function required(name) {
  const value = String(globalThis.process?.env?.[name] || "").trim();
  if (!value) throw new Error(`Variabile Vercel mancante: ${name}`);
  return value;
}

function asJob(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function completed(result) {
  return result?.completed === true || result?.completato === true || result?.status === "completed";
}

function integer(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function workerSource(req) {
  const supplied = String(req?.headers?.["x-worker-source"] || "").trim().toLowerCase();
  if (supplied === "aruba" || supplied === "aruba_cron") return "aruba_cron";
  if (supplied === "vercel-cron" || supplied === "vercel_cron") return "vercel_cron";
  if (supplied === "supabase-cron" || supplied === "supabase_cron") return "supabase_cron";
  return "worker_api";
}

async function rpc(admin, name, parameters) {
  const { data, error } = await admin.rpc(name, parameters);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

async function callAutomation(req, job, secret) {
  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const restartMissingRun = ["products", "stocks"].includes(job.sync_type) && !job.sync_run_id;
  const response = await fetch(`${protocol}://${host}/api/mexal/automation`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "run_scheduled_step",
      syncType: job.sync_type,
      syncRunId: job.sync_run_id || null,
      offset: restartMissingRun ? 0 : Number(job.offset || 0),
      batchSize: job.batch_size || undefined,
      origin: "worker",
      context: { cycle_id: job.cycle_id, job_id: job.id, schedule_id: job.schedule_id, optimization_version: job.payload?.optimization_version, lock_token: job.lock_token },
    }),
  });
  const raw = await response.text();
  let result;
  try { result = raw ? JSON.parse(raw) : {}; }
  catch { throw new Error(`Risposta automation non JSON (HTTP ${response.status}).`); }
  if (!response.ok || result?.success === false) {
    const detail = typeof result?.error === "string" ? result.error : result?.error?.message;
    throw new Error(detail || `Automation fallita (HTTP ${response.status}).`);
  }
  return result;
}

async function resumeBlockedCycles(admin) {
  const { data: cycles, error: cyclesError } = await admin
    .from("mexal_sync_cycles")
    .select("id")
    .eq("status", "failed")
    .order("scheduled_for", { ascending: true })
    .limit(20);
  if (cyclesError) throw cyclesError;
  for (const cycle of cycles || []) {
    const { error: jobsError } = await admin
      .from("mexal_sync_jobs")
      .update({ status: "skipped", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("cycle_id", cycle.id)
      .eq("status", "failed");
    if (jobsError) throw jobsError;
    const { error: cycleError } = await admin
      .from("mexal_sync_cycles")
      .update({
        status: "queued",
        completed_at: null,
        error_message: "Ciclo ripreso automaticamente: i job falliti sono stati saltati.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", cycle.id);
    if (cycleError) throw cycleError;
  }
}

async function runWorker(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  const automationSecret = required("WORKER_SECRET");
  const acceptedSecrets = [
    automationSecret,
    String(globalThis.process?.env?.ARUBA_EMAIL_WORKER_SECRET || "").trim(),
  ].filter(Boolean);
  const authorization = String(req.headers.authorization || "");
  if (!acceptedSecrets.some((secret) => authorization === `Bearer ${secret}`)) {
    return res.status(401).json({ error: "Worker non autorizzato." });
  }

  const admin = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const workerId = `aruba-mexal:${crypto.randomUUID()}`;
  const triggerSource = workerSource(req);
  const startedAt = Date.now();
  const processed = [];
  const manualJobId = Number(req.body?.manualJobId) || null;
  let optimizedProgress = false;
  let yieldedForOct = false;
  let manualWaiting = false;
  let activeJob;
  try {
    if (!manualJobId) await admin.from("mexal_worker_heartbeat").upsert({
      id: 1,
      last_called_at: new Date().toISOString(),
      last_status: "running",
      last_source: triggerSource,
      last_error: null,
      updated_at: new Date().toISOString(),
    });
    await rpc(admin, "recover_expired_mexal_sync_jobs", {});
    if (!manualJobId && !req.body?.continuation) await resumeBlockedCycles(admin);
    let infrastructureHealth;
    try {
      infrastructureHealth = manualJobId || req.body?.continuation ? { status: "not_checked" } : await checkAndRecordInfrastructureHealth(admin);
    } catch (monitorError) {
      infrastructureHealth = {
        status: "error",
        error: monitorError?.message || "Controllo infrastruttura non riuscito.",
      };
      console.error("Infrastructure health monitor failed", infrastructureHealth);
    }
    const producer = manualJobId || req.body?.continuation ? {} : await rpc(admin, "create_daily_mexal_sync_cycle", {
      p_scheduled_for: new Date().toISOString(),
      p_trigger_source: triggerSource,
    });
    if (!manualJobId) await admin.from("mexal_worker_heartbeat").upsert({
      id: 1,
      last_source: triggerSource,
      last_business_date: producer?.businessDate || null,
      last_cycle_id: producer?.cycleId || null,
      last_jobs_created: Number(producer?.jobsCreated || 0),
      updated_at: new Date().toISOString(),
    });
    let documentSync = { status: "not_checked" };
    try {
      if (!manualJobId && !req.body?.continuation) { documentSync = await runAutomaticDocumentSync(admin); await synchronizeNas(admin); }
    } catch (documentError) {
      documentSync = { status: "error", error: documentError?.message || "Sincronizzazione documentale non riuscita." };
    }

    while (processed.length < MAX_STEPS_PER_CALL && Date.now() - startedAt < MAX_WORKER_DURATION_MS) {
      activeJob = asJob(await rpc(admin, manualJobId ? "claim_priority_mexal_sync_job" : "claim_next_mexal_sync_job", {
        p_worker_id: workerId,
        p_lease_seconds: LEASE_SECONDS,
        ...(manualJobId ? { p_manual_job_id: manualJobId } : {}),
      }));
      if (!activeJob) {
        if (!manualJobId) break;
        const { data: pending, error: pendingError } = await admin.from("mexal_sync_jobs")
          .select("status,payload").eq("id", manualJobId).maybeSingle();
        if (pendingError) throw pendingError;
        manualWaiting = pending?.payload?.lane === "manual_priority" && ["queued", "retry"].includes(pending.status);
        if (!manualWaiting) break;
        // Wait only for ownership of the current batch, not the whole cycle.
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      manualWaiting = false;
      optimizedProgress = Number(activeJob.payload?.optimization_version) >= 2;

      const lockToken = String(activeJob.lock_token || "");
      // OCT is a complete document pass: give it a fresh function budget.
      // Release only the newly acquired lease, preserving offset and result.
      if (activeJob.sync_type === "oct_orders" && Date.now() - startedAt > 15000) {
        await rpc(admin, "retry_mexal_sync_job", {
          p_job_id: activeJob.id, p_worker_id: workerId, p_lock_token: lockToken,
          p_error: null, p_offset: Number(activeJob.offset || 0),
          p_sync_run_id: activeJob.sync_run_id, p_result: activeJob.last_result || {}, p_is_failure: false,
        });
        yieldedForOct = true;
        activeJob = null;
        break;
      }
      await rpc(admin, "heartbeat_mexal_sync_job", {
        p_job_id: activeJob.id, p_worker_id: workerId, p_lock_token: lockToken,
      });
      const result = await callAutomation(req, activeJob, automationSecret);
      if (completed(result)) {
        await rpc(admin, "complete_mexal_sync_job", {
          p_job_id: activeJob.id, p_worker_id: workerId, p_lock_token: lockToken, p_result: result,
        });
        processed.push({ job_id: activeJob.id, sync_type: activeJob.sync_type, status: "completed" });
      } else {
        const nextSyncRunId = integer(result.sync_run_id ?? result.syncRunId ?? result.runId ?? result.details?.syncRunId);
        await rpc(admin, "retry_mexal_sync_job", {
          p_job_id: activeJob.id,
          p_worker_id: workerId,
          p_lock_token: lockToken,
          p_error: null,
          p_offset: integer(result.nextOffset ?? result.prossimo_offset ?? activeJob.offset),
          p_sync_run_id: nextSyncRunId,
          p_result: result,
          p_is_failure: false,
        });
        processed.push({ job_id: activeJob.id, sync_type: activeJob.sync_type, status: "progress" });
      }
      activeJob = null;
    }

    const duration = Date.now() - startedAt;
    if (yieldedForOct || manualWaiting || (optimizedProgress && (processed.length >= MAX_STEPS_PER_CALL || duration >= MAX_WORKER_DURATION_MS))) {
      wakeMexalWorker({ manualJobId, continuation: true });
    }
    const status = processed.length ? "completed_steps" : producer?.status === "waiting" ? "waiting_2130" : "idle";
    if (!manualJobId) await admin.from("mexal_worker_heartbeat").upsert({
      id: 1,
      last_completed_at: new Date().toISOString(),
      last_status: status,
      last_source: triggerSource,
      last_business_date: producer?.businessDate || null,
      last_cycle_id: producer?.cycleId || null,
      last_jobs_created: Number(producer?.jobsCreated || 0),
      last_error: null,
      last_duration_ms: duration,
      last_jobs_processed: processed.length,
      updated_at: new Date().toISOString(),
    });
    return res.status(200).json({
      status,
      producer,
      documentSync,
      infrastructureHealth,
      steps: processed.length,
      processed,
      duration_ms: duration,
    });
  } catch (error) {
    if (activeJob?.id && activeJob?.lock_token) {
      await admin.rpc("retry_mexal_sync_job", {
        p_job_id: activeJob.id,
        p_worker_id: workerId,
        p_lock_token: activeJob.lock_token,
        p_error: error?.message || "Errore worker Mexal.",
        p_offset: activeJob.offset,
        p_sync_run_id: null,
        p_result: {},
        p_is_failure: true,
      });
    }
    if (!manualJobId) await admin.from("mexal_worker_heartbeat").upsert({
      id: 1,
      last_completed_at: new Date().toISOString(),
      last_status: "error",
      last_source: triggerSource,
      last_error: error?.message || "Worker Mexal non riuscito.",
      last_duration_ms: Date.now() - startedAt,
      last_jobs_processed: processed.length,
      updated_at: new Date().toISOString(),
    });
    return res.status(502).json({ status: "error", error: error?.message || "Worker Mexal non riuscito." });
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito." });
  const secrets = [globalThis.process?.env?.WORKER_SECRET, globalThis.process?.env?.ARUBA_EMAIL_WORKER_SECRET].filter(Boolean);
  if (!secrets.some((secret) => req.headers.authorization === `Bearer ${secret}`)) return res.status(401).json({ error: "Worker non autorizzato." });
  if (req.body?.manualJobId != null && (!Number.isSafeInteger(Number(req.body.manualJobId)) || Number(req.body.manualJobId) < 1)) return res.status(400).json({ error: "Job non valido." });
  if (req.body?.background === true) {
    const capture = { status() { return this; }, json(value) { return value; } };
    waitUntil(runWorker(req, capture).catch((error) => console.error("Background Mexal worker failed:", error.message)));
    return res.status(202).json({ accepted: true });
  }
  return runWorker(req, res);
}

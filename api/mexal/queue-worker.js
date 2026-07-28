import { createClient } from "@supabase/supabase-js";

const LEASE_SECONDS = 300;

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

async function rpc(admin, name, parameters) {
  const { data, error } = await admin.rpc(name, parameters);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

async function callAutomation(req, job, secret) {
  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const response = await fetch(`${protocol}://${host}/api/mexal/automation`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "run_scheduled_step",
      syncType: job.sync_type,
      syncRunId: job.sync_run_id || null,
      offset: Number(job.offset || 0),
      batchSize: job.batch_size || undefined,
      origin: "worker",
      context: { cycle_id: job.cycle_id, job_id: job.id, schedule_id: job.schedule_id },
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

export default async function handler(req, res) {
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
  let job;
  try {
    await rpc(admin, "recover_expired_mexal_sync_jobs", {});
    await resumeBlockedCycles(admin);
    await rpc(admin, "create_daily_mexal_sync_cycle", { p_scheduled_for: new Date().toISOString() });
    job = asJob(await rpc(admin, "claim_next_mexal_sync_job", {
      p_worker_id: workerId,
      p_lease_seconds: LEASE_SECONDS,
    }));
    if (!job) return res.status(200).json({ status: "idle" });

    const lockToken = String(job.lock_token || "");
    await rpc(admin, "heartbeat_mexal_sync_job", {
      p_job_id: job.id, p_worker_id: workerId, p_lock_token: lockToken,
    });
    const result = await callAutomation(req, job, automationSecret);
    if (completed(result)) {
      await rpc(admin, "complete_mexal_sync_job", {
        p_job_id: job.id, p_worker_id: workerId, p_lock_token: lockToken, p_result: result,
      });
      return res.status(200).json({ status: "completed", job_id: job.id, sync_type: job.sync_type });
    }
    await rpc(admin, "retry_mexal_sync_job", {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_lock_token: lockToken,
      p_error: null,
      p_offset: integer(result.nextOffset ?? result.prossimo_offset ?? job.offset),
      p_sync_run_id: null,
      p_result: result,
      p_is_failure: false,
    });
    return res.status(200).json({ status: "progress", job_id: job.id, sync_type: job.sync_type });
  } catch (error) {
    if (job?.id && job?.lock_token) {
      await admin.rpc("retry_mexal_sync_job", {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_lock_token: job.lock_token,
        p_error: error?.message || "Errore worker Mexal.",
        p_offset: job.offset,
        p_sync_run_id: null,
        p_result: {},
        p_is_failure: true,
      });
    }
    return res.status(502).json({ status: "error", error: error?.message || "Worker Mexal non riuscito." });
  }
}

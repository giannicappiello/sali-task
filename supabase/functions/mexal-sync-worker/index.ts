import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json({ error: "Metodo non consentito" }, 405);
  }

  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const expectedSecret = requireEnv("WORKER_SECRET");
  const authorization = request.headers.get("authorization") || "";
  const workerSecret = request.headers.get("x-mexal-worker-secret") || "";
  if (
    authorization !== `Bearer ${serviceRoleKey}` ||
    workerSecret !== expectedSecret
  ) {
    return json({ error: "Worker non autorizzato" }, 401);
  }

  const workerId = `mexal-sync-worker:${crypto.randomUUID()}`;
  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: job, error } = await supabase.rpc("claim_next_mexal_sync_job", {
    p_worker_id: workerId,
  });

  if (error) {
    console.error(JSON.stringify({
      event: "mexal_job_claim_failed",
      workerId,
      error: error.message,
    }));
    return json({ error: "Claim job non riuscito", details: error.message }, 500);
  }

  const claimedJob = Array.isArray(job) ? job[0] ?? null : job ?? null;
  if (!claimedJob) {
    console.log(JSON.stringify({ event: "mexal_worker_idle", workerId }));
    return json({ status: "idle", workerId, job: null });
  }

  const lockToken = String(claimedJob.lock_token || "");
  if (!lockToken) {
    return json({ error: "Il claim non ha restituito lock_token" }, 500);
  }

  console.log(JSON.stringify({
    event: "mexal_job_claimed",
    workerId,
    jobId: claimedJob.id,
    cycleId: claimedJob.cycle_id,
    syncType: claimedJob.sync_type,
  }));

  try {
    await callLifecycle(supabase, "heartbeat_mexal_sync_job", {
      p_job_id: claimedJob.id,
      p_worker_id: workerId,
      p_lock_token: lockToken,
    });

    const automationResult = await callAutomation(claimedJob);
    const completed = stepCompleted(automationResult);
    const syncRunId = integerOrNull(
      automationResult.syncRunId ??
      automationResult.sync_run_id ??
      automationResult.runId ??
      claimedJob.sync_run_id,
    );
    const nextOffset = integerOrNull(
      automationResult.nextOffset ??
      automationResult.prossimo_offset ??
      claimedJob.offset,
    );

    if (completed) {
      await callLifecycle(supabase, "complete_mexal_sync_job", {
        p_job_id: claimedJob.id,
        p_worker_id: workerId,
        p_lock_token: lockToken,
        p_result: automationResult,
      });
      console.log(JSON.stringify({ event: "mexal_job_completed", workerId, jobId: claimedJob.id }));
      return json({ status: "completed", workerId, jobId: claimedJob.id, syncRunId });
    }

    await callLifecycle(supabase, "retry_mexal_sync_job", {
      p_job_id: claimedJob.id,
      p_worker_id: workerId,
      p_lock_token: lockToken,
      p_error: null,
      p_offset: nextOffset,
      p_sync_run_id: syncRunId,
      p_result: automationResult,
      p_is_failure: false,
    });
    console.log(JSON.stringify({
      event: "mexal_job_continuation_queued",
      workerId,
      jobId: claimedJob.id,
      syncRunId,
      nextOffset,
    }));
    return json({ status: "retry", workerId, jobId: claimedJob.id, syncRunId, nextOffset });
  } catch (executionError) {
    const message = executionError instanceof Error ? executionError.message : String(executionError);
    console.error(JSON.stringify({
      event: "mexal_job_step_failed",
      workerId,
      jobId: claimedJob.id,
      error: message,
    }));
    const retry = await supabase.rpc("retry_mexal_sync_job", {
      p_job_id: claimedJob.id,
      p_worker_id: workerId,
      p_lock_token: lockToken,
      p_error: message,
      p_offset: claimedJob.offset,
      p_sync_run_id: claimedJob.sync_run_id,
      p_result: {},
      p_is_failure: true,
    });
    if (retry.error) {
      console.error(JSON.stringify({
        event: "mexal_job_retry_update_failed",
        workerId,
        jobId: claimedJob.id,
        error: retry.error.message,
      }));
    }
    const retriedJob = Array.isArray(retry.data) ? retry.data[0] ?? null : retry.data;
    return json({
      error: message,
      status: retriedJob?.status || "retry_requested",
      workerId,
      jobId: claimedJob.id,
    }, 502);
  }
});

async function callAutomation(job: Record<string, unknown>) {
  const response = await fetch(requireEnv("MEXAL_AUTOMATION_URL"), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${requireEnv("WORKER_SECRET")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "run_scheduled_step",
      syncType: job.sync_type,
      syncRunId: job.sync_run_id ?? null,
      offset: Number(job.offset || 0),
      batchSize: job.batch_size ?? undefined,
      origin: "worker",
      context: {
        cycle_id: job.cycle_id,
        job_id: job.id,
        schedule_id: job.schedule_id,
      },
    }),
  });
  const text = await response.text();
  let result: Record<string, unknown> = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Automation ha restituito una risposta non JSON (HTTP ${response.status})`);
  }
  if (!response.ok || result.success === false) {
    throw new Error(String(result.error || `Automation non riuscita (HTTP ${response.status})`));
  }
  return result;
}

async function callLifecycle(
  supabase: ReturnType<typeof createClient>,
  functionName: string,
  parameters: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc(functionName, parameters);
  if (error) throw new Error(`${functionName}: ${error.message}`);
  return data;
}

function stepCompleted(result: Record<string, unknown>) {
  if (result.completed === false || result.completato === false || result.status === "running") return false;
  return result.completed === true || result.completato === true || result.status === "completed";
}

function integerOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function requireEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Secret mancante: ${name}`);
  return value;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

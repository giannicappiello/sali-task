import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
};

const JOB_LEASE_SECONDS = 300;

Deno.serve(async (request: Request) => {
  try {
    if (request.method !== "POST") {
      return json({ error: "Metodo non consentito" }, 405);
    }

    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const expectedSecret = requireEnv("WORKER_SECRET");

    const workerSecret =
      request.headers.get("x-mexal-worker-secret") || "";

    const workerSecretMatch =
      workerSecret.trim() === expectedSecret.trim();

    console.log(JSON.stringify({
      event: "worker_request_received",
      hasWorkerSecretHeader: Boolean(workerSecret),
      workerSecretLength: workerSecret.length,
      expectedSecretLength: expectedSecret.length,
    }));


    if (!workerSecretMatch) {

      console.error(JSON.stringify({
        event: "worker_auth_failed",
        workerSecretMatch,
      }));

      return json({
        error: "Worker non autorizzato",
      }, 401);
    }


    const workerId =
      `mexal-sync-worker:${crypto.randomUUID()}`;


    const supabase = createClient(
      requireEnv("SUPABASE_URL"),
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );


    console.log(JSON.stringify({
      event: "worker_authorized",
      workerId,
    }));


    const { data: job, error } =
      await supabase.rpc(
        "claim_next_mexal_sync_job",
        {
          p_worker_id: workerId,
          p_lease_seconds: JOB_LEASE_SECONDS,
        },
      );


    if (error) {

      console.error(JSON.stringify({
        event: "claim_failed",
        error: error.message,
      }));

      return json({
        error: "Claim job non riuscito",
        details: error.message,
      }, 500);
    }


    const claimedJob =
      Array.isArray(job)
        ? job[0] ?? null
        : job ?? null;


    if (!claimedJob) {

      console.log(JSON.stringify({
        event: "worker_idle",
        workerId,
      }));

      return json({
        status: "idle",
        workerId,
      });
    }


    const lockToken =
      String(claimedJob.lock_token || "");


    if (!lockToken) {

      return json({
        error: "lock_token mancante",
      }, 500);
    }


    console.log(JSON.stringify({
      event: "job_claimed",
      workerId,
      jobId: claimedJob.id,
      syncType: claimedJob.sync_type,
    }));


    try {

      await callLifecycle(
        supabase,
        "heartbeat_mexal_sync_job",
        {
          p_job_id: claimedJob.id,
          p_worker_id: workerId,
          p_lock_token: lockToken,
        },
      );


      const automationResult =
        await callAutomation(claimedJob);


      const completed =
        stepCompleted(automationResult);


      if (completed) {

        await callLifecycle(
          supabase,
          "complete_mexal_sync_job",
          {
            p_job_id: claimedJob.id,
            p_worker_id: workerId,
            p_lock_token: lockToken,
            p_result: automationResult,
          },
        );


        console.log(JSON.stringify({
          event: "job_completed",
          jobId: claimedJob.id,
        }));


        return json({
          status: "completed",
          jobId: claimedJob.id,
        });
      }


      await callLifecycle(
        supabase,
        "retry_mexal_sync_job",
        {
          p_job_id: claimedJob.id,
          p_worker_id: workerId,
          p_lock_token: lockToken,
          p_error: null,
          p_offset: integerOrNull(
            automationResult.nextOffset ??
            claimedJob.offset,
          ),
          p_sync_run_id:
            automationResult.syncRunId ??
            claimedJob.sync_run_id,
          p_result: automationResult,
          p_is_failure: false,
        },
      );


      return json({
        status: "retry",
        jobId: claimedJob.id,
      });


    } catch (executionError) {

      const message =
        executionError instanceof Error
          ? executionError.message
          : String(executionError);


      console.error(JSON.stringify({
        event: "job_failed",
        jobId: claimedJob.id,
        error: message,
      }));


      await supabase.rpc(
        "retry_mexal_sync_job",
        {
          p_job_id: claimedJob.id,
          p_worker_id: workerId,
          p_lock_token: lockToken,
          p_error: message,
          p_offset: claimedJob.offset,
          p_sync_run_id: claimedJob.sync_run_id,
          p_result: {},
          p_is_failure: true,
        },
      );


      return json({
        error: message,
      }, 502);
    }


  } catch (error) {

    const message =
      error instanceof Error
        ? error.message
        : String(error);


    console.error(JSON.stringify({
      event: "worker_fatal_error",
      error: message,
    }));


    return json({
      error: message,
    }, 500);
  }
});



async function callAutomation(
  job: Record<string, unknown>,
) {

  const response = await fetch(
    requireEnv("MEXAL_AUTOMATION_URL"),
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${requireEnv("WORKER_SECRET")}`,
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
    },
  );


  const text = await response.text();


  let result: Record<string, any> = {};

  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Risposta automation non JSON (${response.status})`,
    );
  }


  if (!response.ok || result.success === false) {
    throw new Error(
      result.error ||
      `Automation fallita (${response.status})`,
    );
  }


  return result;
}



async function callLifecycle(
  supabase: ReturnType<typeof createClient>,
  functionName: string,
  parameters: Record<string, unknown>,
) {

  const { data, error } =
    await supabase.rpc(
      functionName,
      parameters,
    );


  if (error) {
    throw new Error(
      `${functionName}: ${error.message}`,
    );
  }


  return data;
}



function stepCompleted(
  result: Record<string, any>,
) {

  return (
    result.completed === true ||
    result.completato === true ||
    result.status === "completed"
  );
}



function integerOrNull(value: unknown) {

  if (value == null || value === "") {
    return null;
  }


  const parsed = Number(value);

  return Number.isInteger(parsed)
    ? parsed
    : null;
}



function requireEnv(name: string) {

  const value =
    Deno.env.get(name)?.trim();


  if (!value) {
    throw new Error(
      `Secret mancante: ${name}`,
    );
  }


  return value;
}



function json(
  body: unknown,
  status = 200,
) {

  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: jsonHeaders,
    },
  );
}

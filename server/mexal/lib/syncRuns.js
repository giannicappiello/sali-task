import { isTransientMexalError } from "./transientRetry.js";

/** Central, bigint-safe lifecycle for public.mexal_sync_runs. */
export const SYNC_TYPES = Object.freeze(["clients", "agents", "products", "product_categories", "commercial_conditions", "document_series", "stocks", "list_price_commissions", "orders", "payments", "sales_invoices", "oct_orders"]);
export const RUNNING_TIMEOUT_MS = 30 * 60 * 1000;

function assertSyncType(syncType) {
  if (!SYNC_TYPES.includes(syncType)) throw new Error(`Tipo sincronizzazione non supportato: ${syncType}`);
}
function runId(id) {
  const value = Number(id);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("ID run Mexal non valido.");
  return value;
}
function finishedValues(status, values = {}) {
  const { started_at, ...payload } = values;
  const completedAt = new Date().toISOString();
  return { ...payload, status, completed_at: completedAt, duration_ms: started_at ? Date.parse(completedAt) - Date.parse(started_at) : undefined };
}

export async function cleanupStaleRuns(admin, { syncType } = {}) {
  // Stocks are checkpointed and resumable: an abandoned run remains the lock
  // and must be resumed (or fail because of a real server error), never timed
  // out merely from its age. This also keeps legacy run recovery possible.
  if (syncType === "stocks") return;
  const cutoff = new Date(Date.now() - RUNNING_TIMEOUT_MS).toISOString();
  let query = admin.from("mexal_sync_runs").update({ status: "timeout", completed_at: new Date().toISOString(), error_message: "Run chiusa automaticamente dopo 30 minuti senza completamento." }).eq("status", "running").lt("started_at", cutoff);
  if (syncType) { assertSyncType(syncType); query = query.eq("sync_type", syncType); }
  const { error } = await query;
  if (error) throw error;
}
export async function findRunningSync(admin, syncType) {
  assertSyncType(syncType);
  const { data, error } = await admin.from("mexal_sync_runs").select("id,started_at,status,processed,inserted,updated,skipped,failed,metadata,error_message").eq("sync_type", syncType).eq("status", "running").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}
export function isResumableSyncRun(run) {
  const recordedRetryable = run?.metadata?.recovery?.retryable;
  return run?.sync_type === "stocks"
    && run?.status === "failed"
    && (recordedRetryable === true
      || (recordedRetryable === undefined && isTransientMexalError(new Error(run?.error_message || ""))));
}
export async function findResumableSync(admin, syncType) {
  assertSyncType(syncType);
  if (syncType !== "stocks") return null;
  const { data, error } = await admin.from("mexal_sync_runs")
    .select("id,sync_type,status,started_at,completed_at,processed,inserted,updated,skipped,failed,metadata,error_message")
    .eq("sync_type", syncType).eq("status", "failed")
    .order("started_at", { ascending: false }).limit(10);
  if (error) throw error;
  return (data || []).find(isResumableSyncRun) || null;
}
export async function resumeFailedSync(admin, id, { syncType = "stocks" } = {}) {
  const numericId = runId(id);
  assertSyncType(syncType);
  const current = await getSyncRun(admin, numericId);
  if (!current) throw Object.assign(new Error("Run Mexal non trovata."), { status: 404 });
  if (current.sync_type !== syncType || !isResumableSyncRun(current)) {
    throw Object.assign(new Error("La run Mexal non è recuperabile da un errore transitorio."), { status: 409 });
  }
  const running = await findRunningSync(admin, syncType);
  if (running) {
    throw Object.assign(new Error("È già presente una sincronizzazione giacenze in corso."), {
      status: 409,
      syncRunId: Number(running.id),
    });
  }
  const checkpointFailed = Number.isSafeInteger(Number(current.metadata?.recovery?.checkpoint_failed))
    ? Math.max(0, Number(current.metadata.recovery.checkpoint_failed))
    : Math.max(0, Number(current.failed || 0) - 1);
  const now = new Date().toISOString();
  const metadata = {
    ...(current.metadata || {}),
    recovery: {
      ...(current.metadata?.recovery || {}),
      last_resumed_at: now,
      resume_count: Number(current.metadata?.recovery?.resume_count || 0) + 1,
    },
  };
  const { data, error } = await admin.from("mexal_sync_runs").update({
    status: "running",
    completed_at: null,
    duration_ms: null,
    failed: checkpointFailed,
    error_message: null,
    metadata,
  }).eq("id", numericId).eq("sync_type", syncType).eq("status", "failed")
    .select("id,sync_type,status,started_at,processed,inserted,updated,skipped,failed,metadata,error_message").maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error("La run Mexal è già cambiata durante il recovery."), { status: 409 });
  return data;
}
export async function getSyncRun(admin, id) {
  const numericId = runId(id);
  const { data, error } = await admin.from("mexal_sync_runs").select("id,sync_type,status,started_at,completed_at,duration_ms,processed,inserted,updated,skipped,failed,error_message,metadata").eq("id", numericId).maybeSingle();
  if (error) throw error;
  return data || null;
}
export async function updateSyncRunProgress(admin, id, values = {}) {
  const numericId = runId(id);
  const allowed = ["processed", "inserted", "updated", "skipped", "failed", "metadata"];
  const payload = Object.fromEntries(allowed.filter((key) => values[key] !== undefined).map((key) => [key, values[key]]));
  const { data, error } = await admin.from("mexal_sync_runs").update(payload).eq("id", numericId).eq("status", "running").select("id,status,processed,inserted,updated,skipped,failed,metadata").maybeSingle();
  if (error) throw error;
  return data || null;
}
export async function checkpointSyncRunProgress(admin, id, expectedProcessed, values = {}) {
  const numericId = runId(id);
  const expected = Number(expectedProcessed);
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error("Checkpoint run Mexal non valido.");
  const allowed = ["processed", "inserted", "updated", "skipped", "failed", "metadata"];
  const payload = Object.fromEntries(allowed.filter((key) => values[key] !== undefined).map((key) => [key, values[key]]));
  const { data, error } = await admin.from("mexal_sync_runs").update(payload)
    .eq("id", numericId).eq("status", "running").eq("processed", expected)
    .select("id,sync_type,status,started_at,processed,inserted,updated,skipped,failed,metadata").maybeSingle();
  if (error) throw error;
  if (data) return { run: data, advanced: true };
  const current = await getSyncRun(admin, numericId);
  if (!current) throw Object.assign(new Error("Run Mexal non trovata."), { status: 404 });
  return { run: current, advanced: false };
}
export async function findIdempotentSync(admin, { idempotencyKey, syncType, userId }) {
  const { data, error } = await admin
    .from("mexal_sync_idempotency")
    .select("sync_run_id,response")
    .eq("idempotency_key", idempotencyKey)
    .eq("sync_type", syncType)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}
export async function reserveIdempotentSync(admin, { idempotencyKey, syncType, userId }) {
  const existing = await findIdempotentSync(admin, { idempotencyKey, syncType, userId });
  if (existing) return { ...existing, duplicate: true };
  const { data, error } = await admin
    .from("mexal_sync_idempotency")
    .insert({ idempotency_key: idempotencyKey, sync_type: syncType, user_id: userId })
    .select("sync_run_id,response")
    .single();
  if (!error) return { ...data, duplicate: false };
  if (error.code === "23505") {
    const concurrent = await findIdempotentSync(admin, { idempotencyKey, syncType, userId });
    if (concurrent) return { ...concurrent, duplicate: true };
  }
  throw error;
}
export async function completeIdempotentSync(admin, { idempotencyKey, syncType, userId, syncRunId, response }) {
  const { error } = await admin
    .from("mexal_sync_idempotency")
    .update({ sync_run_id: syncRunId || null, response })
    .eq("idempotency_key", idempotencyKey)
    .eq("sync_type", syncType)
    .eq("user_id", userId);
  if (error) throw error;
}
export async function createSyncRun(admin, { syncType, source = "manual", context = {}, metadata = {} }) {
  assertSyncType(syncType);
  await cleanupStaleRuns(admin, { syncType });
  const running = await findRunningSync(admin, syncType);
  if (running) return { ...running, duplicate: true };
  const { data, error } = await admin.from("mexal_sync_runs").insert({ sync_type: syncType, status: "running", source, context, metadata: { ...metadata, source, context } }).select("id,started_at,status").single();
  if (error) throw error;
  return { ...data, id: runId(data.id), duplicate: false };
}
async function closeSyncRun(admin, id, status, values = {}) {
  const numericId = runId(id);
  const { data: current, error: readError } = await admin.from("mexal_sync_runs").select("started_at").eq("id", numericId).maybeSingle();
  if (readError) throw readError;
  if (!current) throw new Error("Run Mexal non trovata.");
  const { data, error } = await admin
    .from("mexal_sync_runs")
    .update(finishedValues(status, { ...values, started_at: current.started_at }))
    .eq("id", numericId)
    .eq("status", "running")
    .select("id,status")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const { data: closed, error: closedError } = await admin.from("mexal_sync_runs").select("id,status").eq("id", numericId).maybeSingle();
    if (closedError) throw closedError;
    throw Object.assign(new Error(closed ? `La run Mexal è già stata chiusa con stato ${closed.status}.` : "Run Mexal non trovata."), {
      status: closed ? 409 : 404,
      code: "MEXAL_SYNC_RUN_CLOSED",
      run: closed || null,
    });
  }
  return numericId;
}
export const isSyncRunClosedError = (error) => error?.code === "MEXAL_SYNC_RUN_CLOSED";
export const completeSyncRun = (admin, id, values = {}) => closeSyncRun(admin, id, "completed", values);
export const failSyncRun = (admin, id, errorMessage, values = {}) => closeSyncRun(admin, id, "failed", { ...values, failed: Math.max(1, Number(values.failed || 0)), error_message: String(errorMessage || "Errore sincronizzazione.").slice(0, 1000) });
export async function failSyncRunUnlessClosed(admin, id, errorMessage, values = {}) {
  try {
    await failSyncRun(admin, id, errorMessage, values);
    return true;
  } catch (error) {
    if (isSyncRunClosedError(error)) return false;
    throw error;
  }
}
export const cancelSyncRun = (admin, id, values = {}) => closeSyncRun(admin, id, "cancelled", { ...values, failed: Math.max(1, Number(values.failed || 0)), error_message: String(values.error_message || "Sincronizzazione annullata.").slice(0, 1000) });
export const timeoutSyncRun = (admin, id, values = {}) => closeSyncRun(admin, id, "timeout", { ...values, error_message: values.error_message || "Tempo massimo di sincronizzazione superato." });

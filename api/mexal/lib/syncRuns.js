/** Central, bigint-safe lifecycle for public.mexal_sync_runs. */
export const SYNC_TYPES = Object.freeze(["clients", "agents", "products", "commercial_conditions", "document_series", "stocks", "orders", "payments"]);
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
  const cutoff = new Date(Date.now() - RUNNING_TIMEOUT_MS).toISOString();
  let query = admin.from("mexal_sync_runs").update({ status: "timeout", completed_at: new Date().toISOString(), error_message: "Run chiusa automaticamente dopo 30 minuti senza completamento." }).eq("status", "running").lt("started_at", cutoff);
  if (syncType) { assertSyncType(syncType); query = query.eq("sync_type", syncType); }
  const { error } = await query;
  if (error) throw error;
}
export async function findRunningSync(admin, syncType) {
  assertSyncType(syncType);
  const { data, error } = await admin.from("mexal_sync_runs").select("id,started_at,status").eq("sync_type", syncType).eq("status", "running").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
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
  // The unique constraint makes concurrent requests converge on the first run.
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
  const { error } = await admin.from("mexal_sync_runs").update(finishedValues(status, { ...values, started_at: current.started_at })).eq("id", numericId);
  if (error) throw error;
  return numericId;
}
export const completeSyncRun = (admin, id, values = {}) => closeSyncRun(admin, id, "completed", values);
export const failSyncRun = (admin, id, errorMessage, values = {}) => closeSyncRun(admin, id, "failed", { ...values, failed: Math.max(1, Number(values.failed || 0)), error_message: String(errorMessage || "Errore sincronizzazione.").slice(0, 1000) });
export const cancelSyncRun = (admin, id, values = {}) => closeSyncRun(admin, id, "cancelled", { ...values, failed: Math.max(1, Number(values.failed || 0)), error_message: String(values.error_message || "Sincronizzazione annullata.").slice(0, 1000) });
export const timeoutSyncRun = (admin, id, values = {}) => closeSyncRun(admin, id, "timeout", { ...values, error_message: values.error_message || "Tempo massimo di sincronizzazione superato." });

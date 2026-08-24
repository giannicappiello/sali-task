export const STOCK_RESUME_STALE_MS = 30 * 60 * 1000;

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function stockResumeUiState(run, { clientActive = false, now = Date.now() } = {}) {
  const registeredRunning = run?.sync_type === "stocks" && run?.status === "running";
  const checkpointMs = timestamp(run?.metadata?.checkpointed_at || run?.started_at);
  const stale = registeredRunning
    && checkpointMs !== null
    && now - checkpointMs >= STOCK_RESUME_STALE_MS;
  const canResume = registeredRunning && stale && !clientActive;

  return {
    registeredRunning,
    stale,
    canResume,
    running: clientActive || (registeredRunning && !canResume),
    actionLabel: canResume ? "Riprendi" : null,
  };
}

export function claimSyncStart(lockRef, syncType) {
  if (lockRef.current) return false;
  lockRef.current = syncType;
  return true;
}

export function releaseSyncStart(lockRef, syncType) {
  if (lockRef.current === syncType) lockRef.current = null;
}

export function stockSyncRequestPayload({ offset = 0, syncRunId = null, resume = false } = {}) {
  return {
    action: "run_now",
    syncType: "stocks",
    offset,
    batchSize: 12,
    syncRunId,
    resume,
    origin: "integrations",
  };
}

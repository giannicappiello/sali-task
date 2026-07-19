export function getMexalRunId(result = {}) {
  return result.runId || result.sync_run_id || result.syncRunId || null;
}

export function createMexalManualRunRefresh({ refresh, intervalMs = 2500, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval }) {
  let stopped = false;
  let inFlight = false;
  let timer = null;

  async function refreshNow(runId = null) {
    if (stopped || inFlight) return;
    inFlight = true;
    try { await refresh(runId); } catch { /* The active operation keeps its own message. */ } finally { inFlight = false; }
  }

  return {
    start() {
      if (timer || stopped) return;
      timer = setIntervalImpl(() => { refreshNow(); }, intervalMs);
    },
    refreshNow,
    stop() {
      stopped = true;
      if (timer) clearIntervalImpl(timer);
      timer = null;
    },
  };
}

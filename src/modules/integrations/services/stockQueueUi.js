export function stockQueueUiState(job, now = Date.now()) {
  const waiting = ["queued", "retry"].includes(job?.status);
  const retryAt = Date.parse(job?.available_at || "");
  const scheduled = waiting && Number.isFinite(retryAt) && retryAt > now;
  return {
    waiting,
    nextAttemptAt: scheduled ? job.available_at : null,
    phase: waiting
      ? scheduled ? "Ripresa automatica programmata" : "In attesa del worker · ripresa automatica dal punto salvato"
      : "Elaborazione sul server",
    statusLabel: waiting ? "In attesa di ripresa automatica" : null,
  };
}

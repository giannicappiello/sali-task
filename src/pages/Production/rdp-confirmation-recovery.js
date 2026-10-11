export function uncertainConfirmation(error) {
  return error?.name === "TypeError" || error?.name === "AbortError" ||
    /^(V4_CONFIRM_PENDING|V4_PLANNING_BUSY|PROGREMES_TIMEOUT|PROGREMES_HTTP_50[234])$/.test(error?.code || "");
}

export function requiresConfirmationRecovery(preview, code) {
  // A definitive rejection permits correction/recalculation even if the detail
  // still contains the pending marker captured before that response arrived.
  if (code) return uncertainConfirmation({ code });
  return !!preview?.snapshot?.confirmationRecovery && !preview.snapshot.confirmationRecovery.rejected;
}
const pendingError = (cause) => Object.assign(new Error(
  `La verifica non ha restituito un esito conclusivo entro il tempo previsto.${cause?.code === "V4_PLANNING_BUSY" ? ` ${cause.message}` : ""} Premi Recupera conferma per verificare la stessa richiesta. Non aggiornare o ricreare la RdP.`),
  { code: "V4_CONFIRM_PENDING", cause });

export async function recoverConfirmation(send, {
  onPending = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  attempts = 6, attemptTimeoutMs = 75000, totalTimeoutMs = 180000,
} = {}) {
  const deadline = Date.now() + totalTimeoutMs;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw pendingError(lastError);
    const controller = new AbortController();
    let timer;
    try {
      // Bound even a fetch which never resolves; cancellation does not imply rollback.
      return await Promise.race([
        Promise.resolve().then(() => send({ signal: controller.signal })),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort();
          reject(Object.assign(new Error("Risposta MES non ricevuta: verifico la stessa conferma."), { code: "PROGREMES_TIMEOUT" }));
        }, Math.min(attemptTimeoutMs, remaining)); }),
      ]);
    } catch (error) {
      if (!uncertainConfirmation(error)) throw error;
      lastError = error;
      onPending({ attempt: attempt + 1, attempts, message: error.message });
      if (attempt === attempts - 1 || Date.now() >= deadline) throw pendingError(error);
    } finally { clearTimeout(timer); }
    await wait(Math.min(15000, 3000 * (attempt + 1), Math.max(0, deadline - Date.now())));
  }
  throw pendingError(lastError);
}
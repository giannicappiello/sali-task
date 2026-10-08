const listeners = new Set();
export function subscribeSaveOutcomes(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function saveFailureReason(error) {
  const reason = typeof error === "string" ? error : error?.message || error?.details || error?.error?.message;
  return String(reason || "Il servizio non ha restituito il motivo dell’errore.").trim();
}
function publish(outcome) { for (const listener of listeners) listener(outcome); }
export function createSaveOutcome() {
  let settled = false;
  return {
    success(detail = "") {
      if (settled) return;
      settled = true;
      publish({ type: "success", message: "Salvataggio effettuato correttamente." + (detail ? " " + detail : "") });
    },
    observeFailure(value) { this.failure(value); return value; },
    observeMessage(value) {
      if (value?.type === "error") this.failure(value.text);
      if (value?.type === "warning") this.partial(value.text);
      return value;
    },
    partial(detail) {
      if (settled) return;
      settled = true;
      publish({ type: "warning", message: "Salvataggio parziale: " + saveFailureReason(detail) });
    },
    failure(error) {
      if (settled || error == null || error === "" || error === false) return;
      settled = true;
      publish({ type: "error", message: "Salvataggio fallito per: " + saveFailureReason(error) });
    },
  };
}

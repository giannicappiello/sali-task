export function planningConfirmationError(result) {
  const action = result?.controlledAction;
  if (action?.state === "executed") return "";
  return action?.error || result?.answer || "Applicazione non confermata. Aprire il dettaglio nello storico prima di ripetere l'operazione.";
}

export function planningOperation(active, release, current) {
  if (release) return "RELEASE_ODL";
  if (!active) return "MIGRATE";
  return current === "MIGRATE" ? "RECALCULATE" : current;
}

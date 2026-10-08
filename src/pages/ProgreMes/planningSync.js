export async function reconcilePlanningView(token, transport = fetch) {
  const response = await transport("/api/workspace/planning", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "planning_reconcile" }),
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error("Risposta di allineamento non valida (HTTP " + response.status + ")."); }
  const reason = typeof result.error === "string" ? result.error : result.error?.message;
  if (!response.ok) throw new Error(reason || "Allineamento non riuscito (HTTP " + response.status + ").");
  if (result.status !== "COMPLETED") throw new Error(result.message || "Allineamento Workspace non confermato.");
  return result;
}
export function planningSyncFailure(error) {
  if (error?.message?.includes("OCT_DELETED_IN_MEXAL")) return "Piano salvato in MES. Allineamento bloccato: un OCT eliminato in Mexal ha la cancellazione ancora da completare in MES. Apri gli OCT bloccati e verifica la cancellazione in attesa; per lavorazioni avviate va riconciliato prima lo storno. Poi riprova l’allineamento.";
  return "Piano salvato in MES. Allineamento Workspace fallito: " +
    (error?.message || "Il servizio non ha restituito il motivo.") +
    " Riprova l’allineamento; non rigenerare il piano.";
}
export function planningSyncResolution(error) {
  if (!error?.message?.includes("OCT_DELETED_IN_MEXAL")) return null;
  return { path: "/produzione/rdp-workbench?tab=blocked", label: "Apri OCT bloccati" };
}

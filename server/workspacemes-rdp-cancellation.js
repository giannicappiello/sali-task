const CANCELLABLE_STATUSES = new Set(["BLOCKED", "FAILED", "REJECTED", "NON_INVIATA", "PRONTA", "READY"]);
const IRREVERSIBLE_PROPOSAL_STATUSES = new Set(["CONFIRMED", "PLANNED", "INPRODUCTION", "IN_PRODUCTION", "COMPLETED", "PRODUCTIONCOMPLETED"]);
const IRREVERSIBLE_EVENT_PATTERN = /(PRODUCTION.?ORDER.*(CREATED|CONFIRMED)|PLANNING.*(CREATED|CONFIRMED)|LOT.*CREATED|MATERIAL.*(CONSUMED|MOVEMENT)|STOCK.*MOVEMENT|INVENTORY.*MOVEMENT|(LOAD|UNLOAD).*CREATED)/i;

function normalized(value) { return String(value ?? "").trim().toUpperCase(); }

export function evaluateProductionRequestCancellation({ request, proposals = [], events = [] } = {}) {
  if (!request) return { allowed: false, code: "NOT_FOUND", reason: "RdP non trovata." };
  const status = normalized(request.workspace_status || request.stato);
  if (status === "CANCELLED") return { allowed: false, code: "ALREADY_CANCELLED", reason: "La RdP è già annullata." };
  if (!CANCELLABLE_STATUSES.has(status))
    return { allowed: false, code: "INVALID_STATUS", reason: `Lo stato ${status || "non disponibile"} non consente l’annullo.` };

  const irreversibleProposal = proposals.find((proposal) =>
    proposal.confirmation_external_id || proposal.mes_production_order_id || proposal.mes_production_order_number ||
    IRREVERSIBLE_PROPOSAL_STATUSES.has(normalized(proposal.stato)));
  if (irreversibleProposal)
    return { allowed: false, code: "IRREVERSIBLE_EFFECTS", reason: "Esistono già effetti produttivi o una pianificazione confermata." };

  const irreversibleEvent = events.find((event) => IRREVERSIBLE_EVENT_PATTERN.test(String(event.event_type || "")));
  if (irreversibleEvent)
    return { allowed: false, code: "IRREVERSIBLE_EFFECTS", reason: "La telemetria MES registra effetti produttivi non annullabili." };

  return { allowed: true, code: "CANCELLABLE", reason: "La RdP può essere annullata senza cancellare dati o lineage." };
}

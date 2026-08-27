import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProductionRequestCancellation } from "./workspacemes-rdp-cancellation.js";

const blocked = { id: "rdp-1", stato: "Blocked", workspace_status: "Blocked" };

test("una RdP bloccata senza effetti produttivi è annullabile", () => {
  assert.deepEqual(evaluateProductionRequestCancellation({ request: blocked }), {
    allowed: true,
    code: "CANCELLABLE",
    reason: "La RdP può essere annullata senza cancellare dati o lineage.",
  });
});

test("OdP, conferma, pianificazione e lotti bloccano l'annullo", () => {
  assert.equal(evaluateProductionRequestCancellation({ request: blocked, proposals: [{ mes_production_order_id: 12 }] }).code, "IRREVERSIBLE_EFFECTS");
  assert.equal(evaluateProductionRequestCancellation({ request: blocked, proposals: [{ confirmation_external_id: "confirmation-1" }] }).code, "IRREVERSIBLE_EFFECTS");
  assert.equal(evaluateProductionRequestCancellation({ request: blocked, proposals: [{ stato: "Planned" }] }).code, "IRREVERSIBLE_EFFECTS");
  assert.equal(evaluateProductionRequestCancellation({ request: blocked, events: [{ event_type: "LotCreated" }] }).code, "IRREVERSIBLE_EFFECTS");
});

test("eventi di sola analisi materiali non sono scambiati per effetti produttivi", () => {
  assert.equal(evaluateProductionRequestCancellation({ request: blocked, events: [
    { event_type: "MaterialShortageDetected" },
    { event_type: "ProductionRequestBlocked" },
  ] }).allowed, true);
});

test("una RdP annullata o in produzione non è annullabile", () => {
  assert.equal(evaluateProductionRequestCancellation({ request: { workspace_status: "Cancelled" } }).code, "ALREADY_CANCELLED");
  assert.equal(evaluateProductionRequestCancellation({ request: { workspace_status: "InProduction" } }).code, "INVALID_STATUS");
});

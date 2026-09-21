import test from "node:test";
import assert from "node:assert/strict";
import { planningBlockResolution, planningResolutionInput } from "./planning-block-resolution.js";

test("identifica la fase conservata senza interpretare altri errori come revisioni", () => {
  assert.deepEqual(planningBlockResolution("RDP160-04 / OP 5434, Packaging: formula o distinta modificata nei fabbisogni della fase conservata. Aggiornare questa fase nella revisione."),
    { number: "RDP160-04", orderId: 5434, phase: "Confezionamento" });
  assert.equal(planningBlockResolution("OP 5434: materiali mancanti"), null);
});
test("mantiene la previsione selezionata e i vincoli manuali senza applicare o rilasciare", () => {
  const input = { kind: "RECALCULATE", orderIds: [-167], manualChoices: [{ orderId: -167, resourceId: 7 }], startAt: "2026-09-20T09:00", reason: "Urgenza" };
  const result = planningResolutionInput(input, 5434, "2026-09-21T09:00");
  assert.deepEqual(result.orderIds, [-167, 5434]);
  assert.deepEqual(input.orderIds, [-167]);
  assert.deepEqual(result.manualChoices, input.manualChoices);
  assert.equal(result.kind, "RECALCULATE");
  assert.equal(result.startAt, "2026-09-21T09:00");
  assert.deepEqual(planningResolutionInput(result, 5434, result.startAt).orderIds, result.orderIds);
});
test("non restringe una revisione globale e rifiuta azioni di rilascio", () => {
  assert.equal(planningResolutionInput({ kind: "RECALCULATE", orderIds: null }, 5434, "2026-09-21").orderIds, null);
  assert.throws(() => planningResolutionInput({ kind: "RELEASE_ODL" }, 5434, "2026-09-21"));
});

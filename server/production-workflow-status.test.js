import test from "node:test";
import assert from "node:assert/strict";
import { matchesWorkflow, productionWorkflow, workflowOptions } from "../src/features/production-costs/workflow-status.js";
test("workflow filters ignore economic completeness, costs and legacy closed flag", () => {
  for (const provisional of [true, false]) {
    const r = {state: "Completato", provisional, closed: false, actualTotal: null};
    assert.equal(matchesWorkflow(r, "closed"), true);
    assert.equal(matchesWorkflow(r, "open"), false);
  }
  assert.equal(workflowOptions.some(([v]) => v === "incomplete"), false);
});
test("a completed station does not close an order awaiting filling", () => {
  const r = {state: "InProduzione", closed: true, works: [{phase: "Semilavorato", state: "Terminato"}]};
  assert.equal(productionWorkflow(r), "running");
  assert.equal(matchesWorkflow(r, "closed"), false);
  assert.equal(matchesWorkflow(r, "open"), true);
});
test("MES order and phase states have explicit operational categories", () => {
  for (const [state, expected] of [["Nuovo","new"],["Pianificato","planned"],["InProduzione","running"],["Completato","closed"],["Chiuso","closed"],["Annullato","cancelled"]])
    assert.equal(productionWorkflow({state}), expected);
  assert.equal(productionWorkflow({state:"InProduzione",works:[{state:"Sospeso"}]}), "paused");
  assert.equal(productionWorkflow({works:[{state:"Terminato"},{state:"Annullato"}]}), "closed");
  assert.equal(matchesWorkflow({state:"Annullato"},"open"), false);
  assert.equal(matchesWorkflow({},"open"), false);
  assert.equal(matchesWorkflow({},""), true);
});

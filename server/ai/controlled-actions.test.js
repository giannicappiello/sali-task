import test from "node:test";
import assert from "node:assert/strict";
import { availableControlledActions, CONTROLLED_AI_ACTIONS } from "./controlled-actions.js";

test("le azioni operative MES sono esplicite e la forzatura lotto è distruttiva", () => {
  assert.equal(CONTROLLED_AI_ACTIONS.LOT_OVERRIDE.system, "mes");
  assert.equal(CONTROLLED_AI_ACTIONS.LOT_OVERRIDE.risk, "destructive");
  assert.equal(CONTROLLED_AI_ACTIONS.UI_CONFIGURE_VIEW.system, "workspace");
  assert.equal(CONTROLLED_AI_ACTIONS.MES_UI_CONFIGURE_VIEW.system, "mes");
});

test("un profilo senza AI di bozza non riceve strumenti di scrittura", () => {
  assert.deepEqual(availableControlledActions({ profile: { ruoli: {} }, capabilities: { role_ai_level: "analisi", progremes: true } }), {});
});

test("le azioni MES non sono esposte senza accesso ProgreMES", () => {
  const actions = availableControlledActions({ profile: { ruoli: {} }, capabilities: { role_ai_level: "conferma", progremes: false } });
  assert.ok(actions.UI_CONFIGURE_VIEW);
  assert.equal(actions.OP_UPDATE, undefined);
  assert.equal(actions.MES_UI_CONFIGURE_VIEW, undefined);
});

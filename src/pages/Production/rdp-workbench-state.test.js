import test from "node:test";
import assert from "node:assert/strict";
import { confirmedProductionOrder, diagnosticCanBeArchived, diagnosticIsManageable } from "./rdp-workbench-state.js";

test("riconosce l'OP realmente generato dalla conferma MES", () => {
  assert.deepEqual(confirmedProductionOrder({ proposals: [
    { productionOrderId: null, productionOrderNumber: null },
    { productionOrderId: 42, productionOrderNumber: "W-00042" },
  ] }), { id: 42, number: "W-00042" });
  assert.equal(confirmedProductionOrder({ proposals: [] }), null);
});

test("consente azioni solo sulle diagnostiche ancora operative", () => {
  assert.equal(diagnosticIsManageable({ status: "Open" }), true);
  assert.equal(diagnosticIsManageable({ status: "Acknowledged" }), true);
  assert.equal(diagnosticIsManageable({ status: "Resolved" }), false);
  assert.equal(diagnosticIsManageable({ status: "Archived" }), false);
});

test("una diagnostica risolta può essere eliminata dalla vista operativa", () => {
  assert.equal(diagnosticCanBeArchived({ status: "Resolved" }), true);
  assert.equal(diagnosticCanBeArchived({ status: "Ignored" }), true);
  assert.equal(diagnosticCanBeArchived({ status: "Archived" }), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { confirmedProductionOrder, diagnosticCanBeArchived, diagnosticIsManageable, productionOrderProgremesPath, v3RecalculationFailure } from "./rdp-workbench-state.js";

test("riconosce l'OP realmente generato dalla conferma MES", () => {
  assert.deepEqual(confirmedProductionOrder({ proposals: [
    { productionOrderId: null, productionOrderNumber: null },
    { productionOrderId: 42, productionOrderNumber: "W-00042" },
  ] }), { id: 42, number: "W-00042" });
  assert.equal(confirmedProductionOrder({ proposals: [] }), null);
  assert.deepEqual(confirmedProductionOrder({ productionOrders: [{ id: 77, number: "WV2-77" }] }), { id: 77, number: "WV2-77" });
});

test("apre l'OP nella schermata ProgreMES registrata usando il contesto odpId", () => {
  assert.equal(
    productionOrderProgremesPath({ productionOrder: { id: 42 }, externalId: "rdp-123" }),
    "/produzione/progremes.Ordini.Produzione?odpId=42&rdpId=rdp-123",
  );
  assert.equal(
    productionOrderProgremesPath({ externalId: "rdp-123" }),
    "/produzione/progremes.Ordini.Produzione?rdpId=rdp-123",
  );
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

test("una preview V3 bloccata produce un errore esplicito con i blocker univoci", () => {
  assert.deepEqual(v3RecalculationFailure({ status: "BLOCKED", components: [
    { blockerCode: "FORMULA_UOM_MISSING" },
    { blocker_code: "FORMULA_UOM_MISSING" },
    { blockerCode: "FORMULA_NOT_FOUND" },
  ] }), {
    code: "FORMULA_UOM_MISSING · FORMULA_NOT_FOUND",
    message: "La preview è stata elaborata, ma contiene blocchi e non può essere confermata.",
  });
  assert.equal(v3RecalculationFailure({ status: "READY" }), null);
});

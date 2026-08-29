import test from "node:test";
import assert from "node:assert/strict";
import { COMPONENT_KIND, assertPreviewCurrent, buildV3Preview, classifyComponent, confirmationIdempotencyKey, deterministicUuid, netDirectComponent, previewCommandIdentity } from "./workspacemes-v3.js";

test("metadata autorevole prevale sul prefisso FP", () => {
  assert.equal(classifyComponent({ articleCode: "FP001", componentKind: "DIRECT_COMPONENT" }).kind, COMPONENT_KIND.DIRECT);
  assert.equal(classifyComponent({ articleCode: "XX001", metadata: { isFormula: true } }).kind, COMPONENT_KIND.FORMULA);
});

test("retry preview V3 conserva chiave, externalId e correlationId per lo stesso payload", () => {
  const input = { requestId: "rdp-15", octHash: "oct", bomHash: "bom", availabilityVersion: "stock" };
  const first = previewCommandIdentity(input);
  const retry = previewCommandIdentity(input);
  assert.deepEqual(retry, first);
  assert.match(first.idempotencyKey, /^workspacemes:v3:preview:[a-f0-9]{64}$/);
  assert.match(first.externalId, /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notDeepEqual(previewCommandIdentity({ ...input, availabilityVersion: "stock-2" }), first);
  assert.equal(deterministicUuid({ purpose: "confirmation", idempotencyKey: "key" }), deterministicUuid({ purpose: "confirmation", idempotencyKey: "key" }));
});

test("nettificazione DIRECT non conta due volte impegni e scarta arrivi tardivi", () => {
  assert.deepEqual(netDirectComponent({ requiredQuantity: 100, onHandQuantity: 80, committedQuantity: 30, requiredAt: "2026-09-01", supplies: [
    { remainingQuantity: 20, expectedAt: "2026-08-31", confirmed: true },
    { remainingQuantity: 50, expectedAt: "2026-09-02", confirmed: true },
  ] }), { required: 100, onHand: 80, committed: 30, usable: 50, confirmedSupply: 20, uncovered: 30, owner: "WORKSPACE", mutatesInventory: false });
});

test("giacenza Mexal negativa resta auditabile ma non diventa disponibilità utilizzabile", () => {
  assert.deepEqual(netDirectComponent({
    requiredQuantity: 25,
    onHandQuantity: -4,
    committedQuantity: 3,
    supplies: [],
  }), {
    required: 25,
    onHand: -4,
    committed: 3,
    usable: 0,
    confirmedSupply: 0,
    uncovered: 25,
    owner: "WORKSPACE",
    mutatesInventory: false,
  });
});

test("preview aggrega DIRECT e FP/MP senza mutazioni", () => {
  const preview = buildV3Preview({
    identity: { octRevision: 2, octHash: "oct", availabilityVersion: "stock-1", requiredAt: "2026-09-01" },
    finishedQuantity: 10,
    bomRevision: { revision: 4, hash: "bom", baseQuantity: 1, lines: [
      { id: "d", articleCode: "AS01", unitOfMeasure: "PZ", quantity: 2 },
      { id: "f", articleCode: "FP01", unitOfMeasure: "KG", quantity: 0.5 },
    ] },
    directAvailability: { AS01: { onHandQuantity: 15, committedQuantity: 2, supplies: [] } },
    mesFormulaSnapshots: [{ fpCode: "FP01", unitOfMeasure: "KG", formulaCode: "F01", formulaRevision: 3, snapshotHash: "mes", materials: [{ articleCode: "MP01", uncovered: 1 }] }],
    capturedAt: "2026-08-28T00:00:00.000Z",
  });
  assert.equal(preview.status, "READY");
  assert.equal(preview.rows[0].uncovered, 7);
  assert.equal(preview.rows[1].materials[0].articleCode, "MP01");
  assert.equal(preview.mutatesProduction, false);
  assert.match(confirmationIdempotencyKey(preview), /^workspacemes:v3:confirm:[a-f0-9]{64}$/);
  assertPreviewCurrent(preview, preview.sources);
  assert.throws(() => assertPreviewCurrent(preview, { ...preview.sources, octHash: "changed" }), /non è più valida/);
});

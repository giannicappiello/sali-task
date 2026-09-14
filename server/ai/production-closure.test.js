import test from "node:test";
import assert from "node:assert/strict";
import { assertClosureSnapshot, findProductionForClosure } from "./production-closure.js";

const row = { productionId: 77, productionOrderId: 5278, orderNumber: "RDP22", articleCode: "FP123P",
  phase: "Semilavorato", status: "InProduzione", start: "2026-09-11T09:56:00", producedQuantity: 15000,
  scrapQuantity: 0, qualityStatus: "Conforme", releaseStatus: "Deliberato" };
const input = { ...row, targetId: "77", expectedStatus: row.status, expectedStart: row.start,
  expectedProducedQuantity: 15000, expectedScrapQuantity: 0, slAndClAlreadyRegistered: true, reason: "Movimenti già registrati manualmente" };

test("valid exact snapshot can be proposed", () => assert.doesNotThrow(() => assertClosureSnapshot(input, [row])));
for (const [field, value] of Object.entries({ productionId: 5278, productionOrderId: 77, targetId: "5278", orderNumber: "RDP37", articleCode: "FP123N", phase: "Confezionamento", expectedStatus: "Sospeso", expectedStart: "2026-09-12", expectedProducedQuantity: 1, expectedScrapQuantity: 1, slAndClAlreadyRegistered: false, reason: " " })) {
  test(`rejects invalid closure field ${field}`, () => assert.throws(() => assertClosureSnapshot({ ...input, [field]: value }, [row])));
}
test("requires quality and release", () => {
  assert.throws(() => assertClosureSnapshot(input, [{ ...row, qualityStatus: "DaVerificare" }]));
  assert.throws(() => assertClosureSnapshot(input, [{ ...row, releaseStatus: "DaDeliberare" }]));
});
const auth = { scoped: { rpc: async () => ({ data: true }) } };
test("lookup returns only exact order, never another work for same article", async () => {
  const result = await findProductionForClosure(auth, "RDP22", { request: async () => ({ total: 2, items: [row, { ...row, orderNumber: "RDP220" }] }) });
  assert.deepEqual(result.items, [row]);
});
test("lookup fails closed for old MES", async () => {
  await assert.rejects(findProductionForClosure(auth, "RDP22", { request: async () => ({ total: 1, items: [{ ...row, productionId: undefined }] }) }), /Aggiornare/);
});
test("lookup checks permission before reading MES", async () => {
  let called = false;
  await assert.rejects(findProductionForClosure({ scoped: { rpc: async () => ({ data: false }) } }, "RDP22", { request: async () => { called = true; } }), /Permesso/);
  assert.equal(called, false);
});

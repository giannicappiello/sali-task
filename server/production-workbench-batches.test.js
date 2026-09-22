import test from "node:test";
import assert from "node:assert/strict";
import { assertBatchOrderScope, readWorkbenchBatches } from "./production-workbench-batches.js";
import { verifyProductionMessage } from "./progremes-production-hmac.js";
const detail = { request: { rdp_number: 160 }, orders: [{ label: "OC/2/471" }] };
test("commercial expansion accepts only exact authorized OCT/RDP lineage", () => {
  for (const orderNumber of ["RDP160", "RDP160-03", "OC/2/471"])
    assert.doesNotThrow(() => assertBatchOrderScope(detail, { orderNumber }));
  for (const orderNumber of ["RDP1600", "RDP167", "RDP160-03extra", "OC/2/472", ""])
    assert.throws(() => assertBatchOrderScope(detail, { orderNumber }));
});
test("batch read is signed, bounded and rejects another order before returning data", async () => {
  const args = { detail, productionOrderId: 5432, actor: "user", base: "https://mes.example.test", secret: "test" };
  const transport = async (url, options) => {
    assert.equal(url.pathname, "/api/workspace/ai/planning/batches");
    assert.ok(verifyProductionMessage({ method: "POST", path: url.pathname, headers: options.headers, body: options.body, secret: "test" }));
    assert.deepEqual(JSON.parse(options.body), { orderId: 5432, actor: "workspace:user" });
    return { ok: true, json: async () => ({ orderId: 5432, orderNumber: "RDP167", batches: [] }) };
  };
  await assert.rejects(readWorkbenchBatches({ ...args, transport }), /non appartenente/);
  await assert.rejects(readWorkbenchBatches({ ...args, productionOrderId: -1, transport }), /non valido/);
});

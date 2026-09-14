/* global process */
import test from "node:test";
import assert from "node:assert/strict";
import { assertMaterialReallocation, previewMaterialReallocation } from "./material-reallocation.js";
import { availableControlledActions, proposeControlledAction } from "./controlled-actions.js";
const current = { eligible: true, orderId: 1, orderNumber: "RDP1", articleCode: "MP1", unit: "KG",
  hash: "a".repeat(64), missing: 90, donors: [
    { orderId: 2, orderNumber: "RDP2", product: "P2", eligible: true, reserved: 100, required: 100 },
    { orderId: 3, orderNumber: "RDP3", product: "P3", eligible: false, reserved: 100, required: 100 },
  ] };
const input = { targetId: "1", orderNumber: "RDP1", articleCode: "MP1", expectedHash: current.hash,
  transfers: [{ sourceOrderId: 2, quantity: 90 }], reason: "Priorità" };
test("builds human-verifiable evidence from authoritative data", () => {
  const result = assertMaterialReallocation(input, current);
  assert.equal(result.missingAfter, 0); assert.equal(result.transfers[0].reservedAfter, 10);
  assert.equal(result.transfers[0].physicalShortageAfter, 90); assert.match(result.warning, /Nessun avvio/);
});
for (const [field, value] of Object.entries({ targetId: "2", orderNumber: "RDP2", articleCode: "MP2",
  expectedHash: "b".repeat(64), reason: "", transfers: [] })) {
  test("rejects invalid " + field, () => assert.throws(() => assertMaterialReallocation({ ...input, [field]: value }, current)));
}
for (const quantity of [-1, 0, 91, 101, NaN, Infinity, 0.0000001]) {
  test("rejects invalid quantity " + quantity, () => assert.throws(() => assertMaterialReallocation({
    ...input, transfers: [{ sourceOrderId: 2, quantity }],
  }, current)));
}
test("rejects duplicate, unknown, started and destination sources", () => {
  for (const transfers of [[input.transfers[0], input.transfers[0]], [{ sourceOrderId: 3, quantity: 1 }],
    [{ sourceOrderId: 1, quantity: 1 }], [{ sourceOrderId: 999, quantity: 1 }]]) {
    assert.throws(() => assertMaterialReallocation({ ...input, transfers }, current));
  }
});
test("refuses an ineligible destination", () => assert.throws(() => assertMaterialReallocation(input, { ...current, eligible: false })));
test("permission checked before any MES lookup", async () => {
  let called = false;
  await assert.rejects(previewMaterialReallocation({ scoped: { rpc: async () => ({ data: false }) } }, input, async () => { called = true; }), /Permesso/);
  assert.equal(called, false);
});
test("analysis-only profile cannot create write proposal", async () => {
  const auth = { profile: { id: "user" }, capabilities: { progremes: true, role_ai_level: "analisi" } };
  assert.equal(availableControlledActions(auth).MES_MATERIAL_REALLOCATE, undefined);
  await assert.rejects(proposeControlledAction(auth, "MES_MATERIAL_REALLOCATE", input), /autorizzata/);
});
test("signed preview supports planned orders and handles an old MES", async () => {
  const oldBase = process.env.PROGREMES_URL, oldSecret = process.env.PROGREMES_INTEGRATION_SECRET;
  process.env.PROGREMES_URL = "https://mes.example"; process.env.PROGREMES_INTEGRATION_SECRET = "test-only";
  try {
    const auth = { scoped: { rpc: async () => ({ data: true }) } };
    const result = await previewMaterialReallocation(auth, input, async (url, options) => {
      assert.equal(url.pathname, "/api/workspace/ai/materials/preview"); assert.equal(options.method, "POST");
      assert.equal(JSON.parse(options.body).orderNumber, "RDP1");
      assert.ok(Object.keys(options.headers).some(key => /signature/i.test(key)));
      return { ok: true, status: 200, json: async () => current };
    });
    assert.equal(result.orderId, 1);
    await assert.rejects(previewMaterialReallocation(auth, input, async () => ({ status: 404, json: async () => ({}) })), /Aggiornare MES/);
  } finally {
    if (oldBase === undefined) delete process.env.PROGREMES_URL; else process.env.PROGREMES_URL = oldBase;
    if (oldSecret === undefined) delete process.env.PROGREMES_INTEGRATION_SECRET; else process.env.PROGREMES_INTEGRATION_SECRET = oldSecret;
  }
});

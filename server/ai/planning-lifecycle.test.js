import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { assertPlanningConfirmation, planningCall } from "./planning-lifecycle.js";
import { validateWorkspaceV4ProductionResult } from "../workspacemes-v4-api.js";

const version = () => ({ id: "id", expectedHash: "hash", kind: "MIGRATE", status: "PROPOSED", createdAt: new Date().toISOString(), snapshot: { blocks: [] } });
test("migration needs an explicit backup attestation and the exact server version", () => {
  assert.throws(() => assertPlanningConfirmation({ targetId: "id", expectedHash: "hash" }, version()), /backup/);
  assert.throws(() => assertPlanningConfirmation({ targetId: "id", expectedHash: "wrong", backupVerified: true }, version()), /corrispondente/);
  assert.equal(assertPlanningConfirmation({ targetId: "id", expectedHash: "hash", backupVerified: true }, version()).evidence.kind, "MIGRATE");
});
test("stale, blocked or already applied simulations cannot be approved again", () => {
  const input = { targetId: "id", expectedHash: "hash", backupVerified: true };
  for (const patch of [{ status: "APPLIED" }, { snapshot: { blocks: ["Materiale mancante"] } }, { createdAt: "invalid" }, { createdAt: new Date(Date.now() - 1900000).toISOString() }])
    assert.throws(() => assertPlanningConfirmation(input, { ...version(), ...patch }));
});
test("ODL recovery verifies existing lots, not another plan application", () => {
  const v = { ...version(), kind: "RELEASE_ODL", status: "RECONCILIATION_REQUIRED" };
  assert.equal(assertPlanningConfirmation({ targetId: "id", expectedHash: "hash" }, v, true).evidence.status, v.status);
  assert.throws(() => assertPlanningConfirmation({ targetId: "id", expectedHash: "hash" }, v));
});
test("MES cannot be called without the operational permission", async () => {
  let calls = 0;
  await assert.rejects(planningCall({ scoped: { rpc: async () => ({ data: false }) } }, "state", {}, () => { calls++; }), /Permesso/);
  assert.equal(calls, 0);
});
test("old MES fallback HTTP 400 explains the required update instead of claiming an empty plan", async () => {
  const oldUrl = process.env.PROGREMES_URL, oldSecret = process.env.PROGREMES_INTEGRATION_SECRET;
  process.env.PROGREMES_URL = "https://mes.example.test"; process.env.PROGREMES_INTEGRATION_SECRET = "test-secret";
  try {
    await assert.rejects(planningCall({ profile: { id: "user" }, scoped: { rpc: async () => ({ data: true }) } }, "state", {},
      async () => new Response("", { status: 400 })), /AggiornaMES/);
  } finally {
    if (oldUrl === undefined) delete process.env.PROGREMES_URL; else process.env.PROGREMES_URL = oldUrl;
    if (oldSecret === undefined) delete process.env.PROGREMES_INTEGRATION_SECRET; else process.env.PROGREMES_INTEGRATION_SECRET = oldSecret;
  }
});
test("forecast acceptance requires every original line, no OP and no duplicates", () => {
  const preview = { snapshot: { demands: [{ workspaceLineId: "a" }, { workspaceLineId: "b" }] } };
  const result = { status: "FORECAST", productionCreated: false, productionOrders: [], forecastLines: ["a", "b"] };
  assert.deepEqual(validateWorkspaceV4ProductionResult(preview, result), []);
  assert.throws(() => validateWorkspaceV4ProductionResult(preview, { ...result, forecastLines: ["a", "a"] }));
  assert.throws(() => validateWorkspaceV4ProductionResult(preview, { ...result, forecastLines: ["a"] }));
});

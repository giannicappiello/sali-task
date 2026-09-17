import test from "node:test";
import assert from "node:assert/strict";
import process from "node:process";
import { decideControlledAction } from "./ai/controlled-actions.js";
import { planningVersionWithAudit } from "./planning-audit.js";
import { planningConfirmationError, planningOperation } from "../src/pages/Production/planning-confirmation.js";

async function confirm({ apply, status = "PROPOSED", getError = false, mirrorError = false }) {
  const originalFetch = globalThis.fetch;
  const oldUrl = process.env.PROGREMES_URL, oldSecret = process.env.PROGREMES_INTEGRATION_SECRET;
  process.env.PROGREMES_URL = "https://mes.example.test";
  process.env.PROGREMES_INTEGRATION_SECRET = "test-only";
  const pending = { id: "action", tool: "MES_PLAN_APPLY", action: "manual_planning", status: "confirmed", target: "version",
    payload_summary: { targetId: "version", expectedHash: "hash", backupVerified: true, evidence: { snapshot: { tasks: ["large archived evidence"] } } } };
  const calls = []; let completed;
  const chain = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: pending }; } };
  const auth = { manualPlanning: true, profile: { id: "user" }, scoped: {
    from: () => chain, rpc: async name => ({ data: name === "company_mes_ai_can_write" ? true : pending }),
  }, admin: { rpc: async (name, args) => {
    if (name === "reconcile_workspace_planning") return { error: mirrorError ? { message: "Mirror non disponibile" } : null };
    completed = args; return { data: { ...pending, status: args.p_succeeded ? "executed" : "failed", error: args.p_error, result: args.p_result } };
  } } };
  globalThis.fetch = async (url, options) => {
    calls.push({ path: url.pathname, body: JSON.parse(options.body.toString()) });
    if (url.pathname.endsWith("/actions/apply")) {
      if (apply instanceof Error) throw apply;
      return new Response(JSON.stringify(apply.body), { status: apply.status });
    }
    if (url.pathname.endsWith("/planning/get")) {
      if (getError) throw new Error("Lettura MES non disponibile");
      return new Response(JSON.stringify({ id: "version", status }));
    }
    return new Response(JSON.stringify({ configuration: { activeVersionId: "version" } }));
  };
  try { return { result: await decideControlledAction(auth, { proposalId: "action", decision: "confirm" }), completed, calls }; }
  finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.PROGREMES_URL; else process.env.PROGREMES_URL = oldUrl;
    if (oldSecret === undefined) delete process.env.PROGREMES_INTEGRATION_SECRET; else process.env.PROGREMES_INTEGRATION_SECRET = oldSecret;
  }
}

test("a rejected MES confirmation preserves the original cause in audit and UI", async () => {
  const { result, completed, calls } = await confirm({ apply: { status: 409, body: { error: "Piano, materiali o lavorazioni cambiati: ricalcolare l'anteprima." } } });
  assert.equal(result.controlledAction.state, "failed");
  assert.match(completed.p_error, /materiali o lavorazioni cambiati/);
  assert.match(planningConfirmationError(result), /materiali o lavorazioni cambiati/);
  assert.equal(calls.filter(x => x.path.endsWith("/actions/apply")).length, 1);
  assert.deepEqual(calls[0].body.input, { targetId: "version", expectedHash: "hash", backupVerified: true });
});
test("failed verification keeps both the original error and the read failure", async () => {
  const { completed } = await confirm({ apply: { status: 401, body: { code: "INVALID_SIGNATURE" } }, getError: true });
  assert.match(completed.p_error, /INVALID_SIGNATURE/);
  assert.match(completed.p_error, /Lettura MES non disponibile/);
});
test("a transport timeout followed by APPLIED is successful without replay", async () => {
  const { result, calls } = await confirm({ apply: new Error("Timeout"), status: "APPLIED" });
  assert.equal(result.controlledAction.state, "executed");
  assert.equal(planningConfirmationError(result), "");
  assert.equal(calls.filter(x => x.path.endsWith("/actions/apply")).length, 1);
});
test("an applied MES plan with a failed Workspace mirror remains recoverable", async () => {
  const { result } = await confirm({ apply: { status: 200, body: { applied: true } }, status: "APPLIED", mirrorError: true });
  assert.equal(result.controlledAction.result.status, "APPLIED");
  assert.match(planningConfirmationError(result), /allineamento Workspace/);
});
test("audit reads are bounded and scoped to both operator and version", async () => {
  const calls = [];
  const query = Object.fromEntries(["select", "eq", "in", "order", "limit"].map(name => [name, (...args) => { calls.push([name, ...args]); return query; }]));
  query.then = resolve => resolve({ data: [{ id: "a", status: "failed", error: "Cause" }] });
  const value = await planningVersionWithAudit({ profile: { id: "operator" }, scoped: { from: () => query } }, { id: "version", status: "PROPOSED" });
  assert.ok(calls.some(x => x[0] === "eq" && x[1] === "user_id" && x[2] === "operator"));
  assert.ok(calls.some(x => x[0] === "eq" && x[1] === "target" && x[2] === "version"));
  assert.ok(calls.some(x => x[0] === "limit" && x[1] === 10));
  assert.equal(value.confirmationAttempts[0].error, "Cause");
});
test("unknown outcomes are never silently accepted and activation switches operation", () => {
  assert.notEqual(planningConfirmationError({}), "");
  assert.equal(planningOperation(true, false, "MIGRATE"), "RECALCULATE");
  assert.equal(planningOperation(false, false, "CONFIRM_PLAN"), "MIGRATE");
  assert.equal(planningOperation(true, true, "MIGRATE"), "RELEASE_ODL");
});

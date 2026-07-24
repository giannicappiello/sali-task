import assert from "node:assert/strict";
import { mock, test } from "node:test";

process.env.SUPABASE_URL ||= "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "service-role-test";

const supabase = { marker: "admin-supabase" };
const calls = { find: [], reserve: [], complete: [], requireAdmin: 0, adminContexts: [] };

function successfulHandler(_req, res) {
  return res.status(201).json({ sync_run_id: 17 });
}

mock.module("@supabase/supabase-js", {
  exports: { createClient: () => supabase },
});
for (const module of [
  "../server/mexal/sync-clients.js",
  "../server/mexal/sync-agents.js",
  "../server/mexal/sync-commercial-conditions.js",
  "../server/mexal/sync-document-series.js",
  "../server/mexal/stop-sync-run.js",
]) {
  mock.module(module, { exports: { default: successfulHandler } });
}
mock.module("../server/mexal/sync-products.js", {
  exports: { default: successfulHandler, buildMexalClient: () => ({}) },
});
mock.module("../server/mexal/sync-list-price-commissions.js", {
  exports: { syncListPriceCommissions: async () => ({ success: true, runId: 17 }) },
});
mock.module("../server/mexal/agents-access.js", {
  exports: { agentsAccess: async () => ({ success: true }) },
});
mock.module("../api/mexal/lib/auth.js", {
  exports: {
    requireAdmin: async () => {
      calls.requireAdmin += 1;
      const admin = { supabase, authUserId: "auth-user-42" };
      calls.adminContexts.push(admin);
      return admin;
    },
  },
});
mock.module("../api/mexal/lib/syncRuns.js", {
  exports: {
    findRunningSync: async (client, syncType) => {
      calls.find.push({ client, syncType });
      return null;
    },
    reserveIdempotentSync: async (client, values) => {
      calls.reserve.push({ client, values });
      return { duplicate: false, sync_run_id: null, response: null };
    },
    completeIdempotentSync: async (client, values) => {
      calls.complete.push({ client, values });
    },
  },
});

const { default: automation } = await import("../api/mexal/automation.js");

function resetCalls() {
  for (const value of Object.values(calls)) {
    if (Array.isArray(value)) value.length = 0;
  }
  calls.requireAdmin = 0;
}

function response() {
  return {
    statusCode: null,
    payload: null,
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

async function invoke(body, authorization = "Bearer token") {
  const res = response();
  await automation({ method: "POST", body, headers: { authorization } }, res);
  return res;
}

test("run_now without an idempotency key passes the Supabase client to the running-sync check", async () => {
  resetCalls();
  const res = await invoke({ action: "run_now", syncType: "clients" });
  assert.equal(res.statusCode, 201);
  assert.equal(calls.requireAdmin, 1);
  assert.deepEqual(calls.find, [{ client: supabase, syncType: "clients" }]);
  assert.deepEqual(calls.reserve, []);
  assert.deepEqual(calls.complete, []);
});

test("the Vercel dispatcher can run with CRON_SECRET without a user session", async () => {
  const previousSecret = process.env.CRON_SECRET;
  const previousUrl = process.env.SUPABASE_URL;
  const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.CRON_SECRET = "cron-secret-test";
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  try {
    resetCalls();
    const res = await invoke(
      { action: "run_now", syncType: "clients", origin: "cron" },
      "Bearer cron-secret-test",
    );
    assert.equal(res.statusCode, 201);
    assert.equal(calls.requireAdmin, 0);
    assert.deepEqual(calls.find, [{ client: supabase, syncType: "clients" }]);
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousServiceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRole;
  }
});

test("run_now with an idempotency key uses the Supabase client and authenticated user id", async () => {
  resetCalls();
  await invoke({ action: "run_now", syncType: "clients", idempotencyKey: "run-now-key" });
  assert.deepEqual(calls.reserve, [{ client: supabase, values: { idempotencyKey: "run-now-key", syncType: "clients", userId: "auth-user-42" } }]);
  assert.equal(calls.find[0].client, supabase);
  assert.deepEqual(calls.complete, [{ client: supabase, values: { idempotencyKey: "run-now-key", syncType: "clients", userId: "auth-user-42", syncRunId: 17, response: { sync_run_id: 17, success: true, status: "completed" } } }]);
});

test("the authenticated user id returned by requireAdmin is available to idempotency operations", async () => {
  resetCalls();
  await invoke({ action: "run_now", syncType: "clients", idempotencyKey: "auth-user-key" });
  assert.deepEqual(calls.adminContexts, [{ supabase, authUserId: "auth-user-42" }]);
  assert.equal(calls.reserve[0].values.userId, "auth-user-42");
  assert.equal(calls.complete[0].values.userId, "auth-user-42");
});

test("sync_all without an idempotency key passes the Supabase client to every phase", async () => {
  resetCalls();
  const res = await invoke({ action: "sync_all" });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.find.length, 7);
  assert.ok(calls.find.every(({ client }) => client === supabase));
  assert.deepEqual(calls.reserve, []);
});

test("sync_all with an idempotency key persists the authenticated user id", async () => {
  resetCalls();
  await invoke({ action: "sync_all", idempotencyKey: "sync-all-key" });
  assert.deepEqual(calls.reserve, [{ client: supabase, values: { idempotencyKey: "sync-all-key", syncType: "sync_all", userId: "auth-user-42" } }]);
  assert.ok(calls.find.every(({ client }) => client === supabase));
  assert.equal(calls.complete[0].client, supabase);
  assert.equal(calls.complete[0].values.userId, "auth-user-42");
});

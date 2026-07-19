import assert from "node:assert/strict";
import { mock, test } from "node:test";

const supabase = { marker: "admin-supabase" };
const calls = { find: [], reserve: [], complete: [], requireAdmin: 0, adminContexts: [] };

function successfulHandler(_req, res) {
  return res.status(201).json({ sync_run_id: 17 });
}

mock.module("@supabase/supabase-js", {
  exports: { createClient: () => supabase },
});
for (const module of [
  "../server/mexal/sync-products.js",
  "../server/mexal/sync-clients.js",
  "../server/mexal/sync-commercial-conditions.js",
  "../server/mexal/sync-document-series.js",
  "../server/mexal/stop-sync-run.js",
]) {
  mock.module(module, { exports: { default: successfulHandler } });
}
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

async function invoke(body) {
  const res = response();
  await automation({ method: "POST", body, headers: { authorization: "Bearer token" } }, res);
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
  assert.equal(calls.find.length, 5);
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

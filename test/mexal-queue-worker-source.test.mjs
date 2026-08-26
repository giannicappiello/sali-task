import assert from "node:assert/strict";
import test from "node:test";
import { workerSource } from "../api/mexal/queue-worker.js";

test("queue worker normalizza le origini Aruba, Vercel e Supabase", () => {
  assert.equal(workerSource({ headers: { "x-worker-source": "aruba" } }), "aruba_cron");
  assert.equal(workerSource({ headers: { "x-worker-source": "vercel-cron" } }), "vercel_cron");
  assert.equal(workerSource({ headers: { "x-worker-source": "supabase_cron" } }), "supabase_cron");
  assert.equal(workerSource({ headers: {} }), "worker_api");
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { workerSource } from "../api/mexal/queue-worker.js";

const workerSourceCode = fs.readFileSync(new URL("../api/mexal/queue-worker.js", import.meta.url), "utf8");

test("queue worker normalizza le origini Aruba, Vercel e Supabase", () => {
  assert.equal(workerSource({ headers: { "x-worker-source": "aruba" } }), "aruba_cron");
  assert.equal(workerSource({ headers: { "x-worker-source": "vercel-cron" } }), "vercel_cron");
  assert.equal(workerSource({ headers: { "x-worker-source": "supabase_cron" } }), "supabase_cron");
  assert.equal(workerSource({ headers: {} }), "worker_api");
});

test("queue worker registra ciclo e business date subito dopo il producer", () => {
  assert.match(workerSourceCode, /const producer = await rpc[\s\S]*last_business_date: producer\?\.businessDate[\s\S]*let documentSync/);
  assert.match(workerSourceCode, /last_cycle_id: producer\?\.cycleId/);
});

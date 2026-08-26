import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { produceDailyMexalQueue } from "../../api/cron/mexal-dispatcher.js";

const MIGRATION_URL = new URL("../../supabase/migrations/20260825080000_fix_daily_mexal_cycle_oct_jobs.sql", import.meta.url);
const HARDENING_MIGRATION_URL = new URL("../../supabase/migrations/20260826070000_harden_daily_mexal_cycle_dispatch.sql", import.meta.url);
const BASE_TYPES = [
  "clients",
  "agents",
  "products",
  "product_categories",
  "commercial_conditions",
  "document_series",
  "stocks",
  "orders",
  "list_price_commissions",
  "sales_invoices",
];

function schedule(syncType, executionOrder, enabled = true) {
  return {
    id: executionOrder,
    sync_type: syncType,
    enabled,
    schedule_mode: "daily_vercel_hobby",
    batch_size: 100,
    execution_order: executionOrder,
    next_run_at: null,
  };
}

function createStore(initialSchedules) {
  const state = {
    cycle: null,
    schedules: [...initialSchedules],
    jobs: [],
    nextJobId: 1,
  };
  return {
    state,
    async findOrCreateCycle(values) {
      if (state.cycle) return { cycle: state.cycle, created: false };
      state.cycle = { id: 1, ...values };
      return { cycle: state.cycle, created: true };
    },
    async listSchedules() { return state.schedules; },
    async listCycleJobs(cycleId) { return state.jobs.filter((job) => job.cycle_id === cycleId); },
    async listActiveJobs(scheduleIds) {
      const allowed = new Set(scheduleIds.map(String));
      return state.jobs.filter((job) => allowed.has(String(job.schedule_id)) &&
        ["queued", "leased", "running", "retry"].includes(job.status));
    },
    async insertJobs(jobs) {
      const inserted = [];
      for (const job of jobs) {
        if (state.jobs.some((current) => current.cycle_id === job.cycle_id && current.schedule_id === job.schedule_id)) continue;
        const insertedJob = { id: state.nextJobId++, ...job };
        state.jobs.push(insertedJob);
        inserted.push(insertedJob);
      }
      return inserted;
    },
    async markSchedulesQueued() {},
    async updateCycle(_cycleId, values) { Object.assign(state.cycle, values); },
  };
}

const now = new Date("2026-08-25T21:00:00.000Z");
const baseSchedules = () => BASE_TYPES.map((syncType, index) => schedule(syncType, (index + 1) * 5));

test("10 schedule esistenti più oct_orders attivo generano 11 job ordinati", async () => {
  const store = createStore([...baseSchedules(), schedule("oct_orders", 90)]);
  const result = await produceDailyMexalQueue({ store, now });
  assert.equal(result.jobsCreated, 11);
  assert.equal(store.state.jobs.length, 11);
  assert.deepEqual(store.state.jobs.map((job) => job.execution_order), [...store.state.jobs]
    .map((job) => job.execution_order).sort((left, right) => left - right));
  assert.equal(store.state.jobs.at(-1).sync_type, "oct_orders");
  assert.equal(store.state.jobs.at(-1).execution_order, 90);
});

test("oct_orders disabilitato resta escluso", async () => {
  const store = createStore([...baseSchedules(), schedule("oct_orders", 90, false)]);
  const result = await produceDailyMexalQueue({ store, now });
  assert.equal(result.jobsCreated, 10);
  assert.equal(store.state.jobs.some((job) => job.sync_type === "oct_orders"), false);
});

test("doppia creazione dello stesso ciclo non duplica i job", async () => {
  const store = createStore([...baseSchedules(), schedule("oct_orders", 90)]);
  const first = await produceDailyMexalQueue({ store, now });
  const second = await produceDailyMexalQueue({ store, now });
  assert.equal(first.jobsCreated, 11);
  assert.equal(second.jobsCreated, 0);
  assert.equal(store.state.jobs.length, 11);
});

test("Aruba e Vercel convergono sullo stesso ciclo senza duplicati", async () => {
  const store = createStore([...baseSchedules(), schedule("oct_orders", 90)]);
  const aruba = await produceDailyMexalQueue({
    store,
    now: new Date("2026-08-25T21:00:00.000Z"),
    source: "aruba_cron",
  });
  const vercel = await produceDailyMexalQueue({
    store,
    now: new Date("2026-08-25T22:30:00.000Z"),
    source: "vercel_cron",
  });
  assert.equal(aruba.cycleKey, "daily-2300:2026-08-25:Europe/Rome");
  assert.equal(vercel.cycleKey, aruba.cycleKey);
  assert.equal(vercel.jobsCreated, 0);
  assert.equal(store.state.jobs.length, 11);
});

test("una seconda chiamata inserisce soltanto oct_orders mancante", async () => {
  const store = createStore(baseSchedules());
  await produceDailyMexalQueue({ store, now });
  store.state.schedules.push(schedule("oct_orders", 90));
  const backfill = await produceDailyMexalQueue({ store, now });
  assert.equal(backfill.jobsCreated, 1);
  assert.equal(store.state.jobs.length, 11);
  assert.equal(store.state.jobs.filter((job) => job.sync_type === "oct_orders").length, 1);
});

test("migration legge gli schedule attivi senza allow-list e offre backfill idempotente", () => {
  const migration = fs.readFileSync(MIGRATION_URL, "utf8");
  assert.match(migration, /from public\.mexal_sync_schedules s\s+where s\.enabled = true/is);
  assert.match(migration, /order by s\.execution_order, s\.sync_type, s\.id/i);
  assert.match(migration, /on conflict \(cycle_id, schedule_id\) do nothing/i);
  assert.match(migration, /create or replace function public\.backfill_mexal_sync_cycle_job/i);
  assert.match(migration, /where sync_type = pg_catalog\.btrim\(p_sync_type\)\s+and enabled = true/is);
  assert.doesNotMatch(migration, /s\.sync_type\s+in\s*\(/i);
});

test("migration non ridefinisce claim, heartbeat o retry", () => {
  const migration = fs.readFileSync(MIGRATION_URL, "utf8");
  assert.doesNotMatch(migration, /create or replace function public\.claim_next_mexal_sync_job/i);
  assert.doesNotMatch(migration, /create or replace function public\.heartbeat_mexal_sync_job/i);
  assert.doesNotMatch(migration, /create or replace function public\.retry_mexal_sync_job/i);
  assert.doesNotMatch(migration, /create or replace function public\.recover_expired_mexal_sync_jobs/i);
});

test("hardening usa business date Europe/Rome, lock e origine esplicita", () => {
  const migration = fs.readFileSync(HARDENING_MIGRATION_URL, "utf8");
  assert.match(migration, /p_trigger_source text/i);
  assert.match(migration, /v_local_timestamp::time < time '23:00' then 1 else 0/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /on conflict \(cycle_key\) do nothing/i);
  assert.match(migration, /on conflict \(cycle_id, schedule_id\) do nothing/i);
  assert.match(migration, /last_business_date/i);
  assert.match(migration, /last_source/i);
  assert.doesNotMatch(migration, /backfill_mexal_sync_cycle_job/i);
  assert.doesNotMatch(migration, /claim_next_mexal_sync_job/i);
  assert.doesNotMatch(migration, /retry_mexal_sync_job/i);
});

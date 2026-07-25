import assert from "node:assert/strict";
import fs from "node:fs";
import {
  cycleKeyFor,
  dueSchedules,
  isCronAuthorized,
  produceDailyMexalQueue,
  scheduledDateInTimezone,
} from "../api/cron/mexal-dispatcher.js";

const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const dispatcherSource = fs.readFileSync(new URL("../api/cron/mexal-dispatcher.js", import.meta.url), "utf8");
assert.equal(vercel.functions["api/cron/mexal-dispatcher.js"]?.maxDuration, 300);
assert.equal(vercel.crons.some((cron) => (
  cron.path === "/api/cron/mexal-dispatcher" && cron.schedule === "0 23 * * *"
)), true);
assert.match(dispatcherSource, /\.rpc\("create_daily_mexal_sync_cycle"/);

assert.equal(isCronAuthorized({ headers: { authorization: "Bearer test-secret" } }, "test-secret"), true);
assert.equal(isCronAuthorized({ headers: { authorization: "Bearer wrong" } }, "test-secret"), false);
assert.equal(isCronAuthorized({ headers: {} }, ""), false);

const now = new Date("2026-07-25T22:30:00.000Z");
assert.equal(scheduledDateInTimezone(now), "2026-07-26");
assert.equal(cycleKeyFor("2026-07-26"), "daily:2026-07-26:Europe/Rome");

const schedules = [
  { id: 1, sync_type: "clients", enabled: false, schedule_mode: "daily_vercel_hobby", execution_order: 1, batch_size: 100, next_run_at: null },
  { id: 2, sync_type: "products", enabled: true, schedule_mode: "daily_vercel_hobby", execution_order: 20, batch_size: 8, next_run_at: "2026-07-25T20:00:00.000Z" },
  { id: 3, sync_type: "stocks", enabled: true, schedule_mode: "daily_vercel_hobby", execution_order: 10, batch_size: 12, next_run_at: "2026-07-27T00:00:00.000Z" },
  { id: 4, sync_type: "orders", enabled: true, schedule_mode: "unsupported", execution_order: 5, batch_size: 100, next_run_at: null },
  { id: 5, sync_type: "agents", enabled: true, schedule_mode: "daily_vercel_hobby", execution_order: 20, batch_size: 50, next_run_at: null },
];
assert.deepEqual(dueSchedules(schedules, now).map(({ id }) => id), [4, 5, 2]);

function queueStore() {
  const state = {
    cycles: [],
    jobs: [],
    scheduleUpdates: [],
    cycleUpdates: [],
    runsCreated: 0,
    automationCalls: 0,
  };
  return {
    state,
    async findOrCreateCycle(values) {
      const existing = state.cycles.find((cycle) => cycle.cycle_key === values.cycle_key);
      if (existing) return { cycle: existing, created: false };
      const cycle = { id: state.cycles.length + 1, ...values };
      state.cycles.push(cycle);
      return { cycle, created: true };
    },
    async listSchedules() { return schedules; },
    async listCycleJobs(cycleId) { return state.jobs.filter((job) => job.cycle_id === cycleId); },
    async listActiveJobs(scheduleIds) {
      return state.jobs.filter((job) => scheduleIds.includes(job.schedule_id) && ["queued", "leased", "running", "retry"].includes(job.status));
    },
    async insertJobs(jobs) {
      const inserted = [];
      for (const values of jobs) {
        if (state.jobs.some((job) => job.cycle_id === values.cycle_id && job.schedule_id === values.schedule_id)) continue;
        const job = { id: state.jobs.length + 1, ...values };
        state.jobs.push(job);
        inserted.push(job);
      }
      return inserted;
    },
    async markSchedulesQueued(ids, timestamp) { state.scheduleUpdates.push({ ids, timestamp }); },
    async updateCycle(id, values) {
      state.cycleUpdates.push({ id, values });
      Object.assign(state.cycles.find((cycle) => cycle.id === id), values);
    },
  };
}

const store = queueStore();
const first = await produceDailyMexalQueue({ store, now });
assert.equal(first.cycleKey, "daily:2026-07-26:Europe/Rome");
assert.equal(first.created, true);
assert.equal(first.jobsCreated, 2);
assert.equal(first.existingJobs, 0);
assert.equal(first.skippedActive, 0);
assert.equal(first.unsupportedSchedules, 1);
assert.equal(first.waiting, false);
assert.deepEqual(store.state.jobs.map(({ sync_type }) => sync_type), ["agents", "products"]);
assert.deepEqual(store.state.jobs.map(({ execution_order }) => execution_order), [20, 20]);
assert.deepEqual(store.state.jobs.map(({ batch_size }) => batch_size), [50, 8]);
assert.equal(store.state.jobs.every((job) => (
  job.status === "queued"
  && job.offset === 0
  && job.attempts === 0
  && job.max_attempts === 5
  && !JSON.stringify(job.payload).includes("secret")
)), true);
assert.deepEqual(store.state.scheduleUpdates[0].ids, [5, 2]);
assert.equal("last_run_at" in store.state.scheduleUpdates[0], false);
assert.equal("next_run_at" in store.state.scheduleUpdates[0], false);
assert.equal(store.state.runsCreated, 0);
assert.equal(store.state.automationCalls, 0);

const second = await produceDailyMexalQueue({ store, now });
assert.equal(second.created, false);
assert.equal(second.jobsCreated, 0);
assert.equal(second.existingJobs, 2);
assert.equal(store.state.jobs.length, 2);

store.state.cycles[0].status = "running";
store.state.cycles[0].completed_jobs = 1;
store.state.cycles[0].failed_jobs = 1;
await produceDailyMexalQueue({ store, now });
assert.equal(store.state.cycles[0].status, "running");
assert.equal(store.state.cycles[0].completed_jobs, 1);
assert.equal(store.state.cycles[0].failed_jobs, 1);

const activeStore = queueStore();
activeStore.state.jobs.push({
  id: 90,
  cycle_id: 999,
  schedule_id: 2,
  sync_type: "products",
  status: "running",
});
const activeResult = await produceDailyMexalQueue({ store: activeStore, now });
assert.equal(activeResult.jobsCreated, 1);
assert.equal(activeResult.skippedActive, 1);
assert.equal(activeResult.waiting, false);
assert.deepEqual(activeStore.state.jobs.filter((job) => job.cycle_id === 1).map(({ sync_type }) => sync_type), ["agents"]);

const waitingStore = queueStore();
waitingStore.listSchedules = async () => [schedules[1]];
waitingStore.state.jobs.push({
  id: 91,
  cycle_id: 999,
  schedule_id: 2,
  sync_type: "products",
  status: "running",
});
const waiting = await produceDailyMexalQueue({ store: waitingStore, now });
assert.equal(waiting.jobsCreated, 0);
assert.equal(waiting.skippedActive, 1);
assert.equal(waiting.waiting, true);
assert.equal(waitingStore.state.cycles[0].status, "queued");
assert.equal(waitingStore.state.cycles[0].completed_at, null);

const emptyStore = queueStore();
emptyStore.listSchedules = async () => [];
const empty = await produceDailyMexalQueue({ store: emptyStore, now });
assert.equal(empty.jobsCreated, 0);
assert.equal(emptyStore.state.cycles[0].status, "completed");
assert.equal(Boolean(emptyStore.state.cycles[0].completed_at), true);

const terminalStore = queueStore();
terminalStore.state.cycles.push({
  id: 1,
  cycle_key: "daily:2026-07-26:Europe/Rome",
  status: "completed",
  completed_jobs: 2,
  failed_jobs: 0,
});
terminalStore.state.jobs.push(
  { id: 101, cycle_id: 1, schedule_id: 2, status: "completed" },
  { id: 102, cycle_id: 1, schedule_id: 5, status: "completed" },
);
const terminal = await produceDailyMexalQueue({ store: terminalStore, now });
assert.equal(terminal.created, false);
assert.equal(terminal.existingJobs, 2);
assert.equal(terminal.waiting, false);
assert.equal(terminalStore.state.cycles[0].status, "completed");
assert.equal(terminalStore.state.cycles[0].completed_jobs, 2);
assert.equal(terminalStore.state.cycles[0].failed_jobs, 0);

console.log("mexal dispatcher: produttore giornaliero idempotente verificato");

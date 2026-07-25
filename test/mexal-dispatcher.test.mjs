import assert from "node:assert/strict";
import fs from "node:fs";
import { dispatchNextSchedule, selectDueSchedule } from "../api/cron/mexal-dispatcher.js";

const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
assert.equal(vercel.functions["api/cron/mexal-dispatcher.js"]?.maxDuration, 300);
assert.equal(vercel.crons.some((cron) => cron.path === "/api/cron/mexal-dispatcher" && cron.schedule === "*/10 * * * *"), true);

const now = new Date("2026-07-25T10:00:00.000Z");
const schedules = [
  { id: 1, sync_type: "clients", enabled: false, schedule_mode: "daily_vercel_hobby", execution_order: 1, next_run_at: null },
  { id: 2, sync_type: "products", enabled: true, schedule_mode: "daily_vercel_hobby", execution_order: 2, next_run_at: "2026-07-25T09:00:00.000Z" },
  { id: 3, sync_type: "stocks", enabled: true, schedule_mode: "daily_vercel_hobby", execution_order: 1, next_run_at: "2026-07-25T11:00:00.000Z" },
  { id: 4, sync_type: "orders", enabled: true, schedule_mode: "unsupported", execution_order: 0, next_run_at: null },
];

assert.equal(selectDueSchedule(schedules, now)?.id, 2);

const calls = [];
const updates = [];
const summary = await dispatchNextSchedule({
  schedules,
  now: () => now,
  hasRunningRun: async () => ({ id: 77, processed: 24, status: "running" }),
  executeStep: async (type, schedule, existingRun) => {
    calls.push({ type, schedule, existingRun });
    return { success: true, status: "running", completed: false, syncRunId: existingRun.id, nextOffset: 32 };
  },
  updateSchedule: async (id, values) => updates.push({ id, values }),
});

assert.equal(calls.length, 1);
assert.equal(calls[0].type, "products");
assert.equal(calls[0].existingRun.id, 77);
assert.equal(summary.status, "running");
assert.equal(summary.selected.runId, 77);
assert.equal(updates.length, 2);
assert.equal(updates[0].values.last_status, "running");
assert.equal(updates[1].values.next_run_at, "2026-07-25T10:10:00.000Z");

const completedUpdates = [];
const completed = await dispatchNextSchedule({
  schedules: [{ id: 5, sync_type: "agents", enabled: true, schedule_mode: "daily_vercel_hobby", execution_order: 1, next_run_at: null }],
  now: () => now,
  hasRunningRun: async () => null,
  executeStep: async () => ({ success: true, status: "completed", completed: true, syncRunId: 88 }),
  updateSchedule: async (id, values) => completedUpdates.push({ id, values }),
});
assert.equal(completed.status, "completed");
assert.equal(completedUpdates.at(-1).values.next_run_at, "2026-07-26T10:00:00.000Z");

console.log("mexal dispatcher: selezione dovuta, singolo step e ripianificazione verificati");

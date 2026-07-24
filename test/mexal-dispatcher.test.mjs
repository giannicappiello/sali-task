import assert from "node:assert/strict";
import { dispatchSchedules } from "../api/cron/mexal-dispatcher.js";

const calls = [];
const updates = [];
const recorded = [];
const runningStockRun = { id: 77, processed: 24, status: "running" };

const summary = await dispatchSchedules({
  schedules: ["clients", "agents", "products", "commercial_conditions", "document_series", "stocks", "orders"].map((sync_type, index) => ({ id: index + 1, sync_type, execution_order: index + 1 })),
  hasRunningRun: async (type) => (type === "stocks" ? runningStockRun : null),
  execute: async (type, schedule, existingRun) => {
    calls.push({ type, scheduleId: schedule.id, existingRun });
    if (type === "commercial_conditions") throw new Error("Mexal non disponibile");
  },
  updateSchedule: async (id, values) => updates.push({ id, values }),
  recordScheduleResult: async (schedule, item) => recorded.push({ schedule, item }),
});

assert.deepEqual(calls.map(({ type }) => type), ["clients", "agents", "products", "commercial_conditions", "document_series", "stocks", "orders"]);
assert.equal(calls.find(({ type }) => type === "stocks")?.existingRun, runningStockRun);
assert.deepEqual(summary.executed.map(({ sync_type, status }) => [sync_type, status]), [["clients", "completed"], ["agents", "completed"], ["products", "completed"], ["commercial_conditions", "failed"], ["document_series", "completed"], ["stocks", "completed"], ["orders", "completed"]]);
assert.equal(summary.ok, false);
assert.equal(updates.length, 7);
assert.deepEqual(recorded, []);
console.log("mexal dispatcher: sequenza, errori isolati e ripresa delle run verificati");

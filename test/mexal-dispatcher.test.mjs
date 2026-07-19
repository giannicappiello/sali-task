import assert from "node:assert/strict";
import { dispatchSchedules } from "../api/cron/mexal-dispatcher.js";

const calls = [];
const updates = [];
const summary = await dispatchSchedules({
  schedules: ["clients", "products", "commercial_conditions", "document_series", "stocks", "orders"].map((sync_type, index) => ({ id: index + 1, sync_type, execution_order: index + 1 })),
  hasRunningRun: async (type) => type === "stocks",
  execute: async (type) => { calls.push(type); if (type === "commercial_conditions") throw new Error("Mexal non disponibile"); },
  updateSchedule: async (id, values) => updates.push({ id, values }),
});

assert.deepEqual(calls, ["clients", "products", "commercial_conditions", "document_series"]);
assert.deepEqual(summary.executed.map(({ sync_type, status }) => [sync_type, status]), [["clients", "completed"], ["products", "completed"], ["commercial_conditions", "failed"], ["document_series", "completed"], ["stocks", "skipped"], ["orders", "skipped"]]);
assert.equal(summary.ok, false);
assert.equal(updates.length, 6);
console.log("mexal dispatcher: sequenza, errori isolati e ordini skipped verificati");

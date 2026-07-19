import assert from "node:assert/strict";
import { nextRunAt, executeActionChain } from "../api/mexal/lib/automationEngine.js";
assert.equal(nextRunAt("manual"), null);
assert.equal(nextRunAt("hourly", new Date("2026-01-01T00:00:00Z")), "2026-01-01T01:00:00.000Z");
assert.equal((await executeActionChain({ actions: ["a", "b"], executeAction: async (action) => action })).status, "completed");
assert.equal((await executeActionChain({ actions: ["a"], executeAction: async () => { throw new Error("x"); } })).status, "failed");
assert.equal((await executeActionChain({ actions: ["a"], isStopped: async () => true, executeAction: async () => "never" })).status, "stopped");
console.log("automation engine: schedule, chain, failure and stop ok");

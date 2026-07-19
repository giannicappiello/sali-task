import assert from "node:assert/strict";
import { createMexalManualRunRefresh, getMexalRunId } from "../src/modules/integrations/services/mexalManualRunRefresh.js";

let tick;
let cleared = false;
const calls = [];
let resolveRefresh;
const controller = createMexalManualRunRefresh({
  refresh: (runId) => { calls.push(runId); return new Promise((resolve) => { resolveRefresh = resolve; }); },
  intervalMs: 2500,
  setIntervalImpl: (callback) => { tick = callback; return 42; },
  clearIntervalImpl: (id) => { assert.equal(id, 42); cleared = true; },
});

controller.start();
assert.equal(calls.length, 0, "does not poll before manual synchronization is active");
tick();
assert.deepEqual(calls, [null], "polls while manual synchronization is active");
tick();
assert.deepEqual(calls, [null], "does not overlap pending refreshes");
resolveRefresh();
await Promise.resolve();
const immediateRefresh = controller.refreshNow("batch-run");
resolveRefresh();
await immediateRefresh;
assert.deepEqual(calls, [null, "batch-run"], "refreshes immediately once the first batch exposes its run id");
controller.stop();
assert.equal(cleared, true);
tick();
assert.deepEqual(calls, [null, "batch-run"], "stops polling on completion, error, cancellation, or unmount cleanup");

assert.equal(getMexalRunId({ runId: "a" }), "a");
assert.equal(getMexalRunId({ sync_run_id: "b" }), "b");
assert.equal(getMexalRunId({ syncRunId: "c" }), "c");
console.log("manual Mexal run refresh polling handles active batches, cancellation, and all run id shapes");

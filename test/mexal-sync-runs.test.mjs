import assert from "node:assert/strict";
import { cancelSyncRun, completeSyncRun, failSyncRun, isSyncRunClosedError, timeoutSyncRun } from "../api/mexal/lib/syncRuns.js";

function lifecycleAdmin(initialStatus) {
  const calls = [];
  const run = { id: 15, status: initialStatus, started_at: "2026-07-19T10:00:00Z" };
  const read = (fields) => ({
    eq() {
      return { maybeSingle: async () => ({ data: fields === "started_at" ? { started_at: run.started_at } : { id: run.id, status: run.status }, error: null }) };
    },
  });
  return {
    calls,
    from() {
      return {
        select: read,
        update(values) {
          calls.push(values);
          return {
            eq(column, value) {
              assert.equal(column, "id"); assert.equal(value, 15);
              return {
                eq(statusColumn, statusValue) {
                  assert.equal(statusColumn, "status"); assert.equal(statusValue, "running");
                  return { select() { return { maybeSingle: async () => {
                    if (run.status !== "running") return { data: null, error: null };
                    run.status = values.status;
                    return { data: { id: run.id, status: run.status }, error: null };
                  } }; } };
                },
              };
            },
          };
        },
      };
    },
  };
}

for (const [initial, close, expected] of [
  ["completed", failSyncRun, "completed non può diventare failed"],
  ["cancelled", completeSyncRun, "cancelled non può diventare completed"],
  ["failed", cancelSyncRun, "failed non può diventare cancelled"],
]) {
  const admin = lifecycleAdmin(initial);
  await assert.rejects(() => close(admin, 15, "errore"), (error) => isSyncRunClosedError(error) && error.status === 409, expected);
  assert.equal(admin.calls.length, 1);
}

const running = lifecycleAdmin("running");
await timeoutSyncRun(running, 15);
assert.equal(running.calls[0].status, "timeout", "una run running viene chiusa correttamente");
console.log("mexal sync runs: terminal states cannot be overwritten and running runs close atomically");

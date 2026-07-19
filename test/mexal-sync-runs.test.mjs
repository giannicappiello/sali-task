import assert from "node:assert/strict";
import { cancelSyncRun, completeSyncRun, failSyncRun, failSyncRunUnlessClosed, isSyncRunClosedError, timeoutSyncRun } from "../api/mexal/lib/syncRuns.js";

function lifecycleAdmin(initialStatus, updateError = null) {
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
                    if (updateError) return { data: null, error: updateError };
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

const cancelled = lifecycleAdmin("cancelled");
assert.equal(await failSyncRunUnlessClosed(cancelled, 15, "errore durante sync"), false, "una run cancellata non viene trasformata in failed e non interrompe il catch");
const databaseError = Object.assign(new Error("database non disponibile"), { code: "08006" });
await assert.rejects(() => failSyncRunUnlessClosed(lifecycleAdmin("running", databaseError), 15, "errore durante sync"), databaseError, "gli errori DB reali vengono propagati");

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

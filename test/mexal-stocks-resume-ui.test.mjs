import assert from "node:assert/strict";
import test from "node:test";
import {
  STOCK_RESUME_STALE_MS,
  claimSyncStart,
  releaseSyncStart,
  stockResumeUiState,
  stockSyncRequestPayload,
} from "../src/modules/integrations/services/stockResumeUi.js";

const checkpoint = "2026-08-24T13:49:44.000Z";
const running437 = {
  id: 437,
  sync_type: "stocks",
  status: "running",
  processed: 2916,
  updated: 1626,
  failed: 0,
  metadata: { stock_state_version: 2, next_offset: 2916, checkpointed_at: checkpoint },
};

test("una run realmente attiva mantiene il pulsante disabilitato", () => {
  const fresh = stockResumeUiState(running437, { now: Date.parse(checkpoint) + STOCK_RESUME_STALE_MS - 1 });
  const clientActive = stockResumeUiState(running437, { clientActive: true, now: Date.parse(checkpoint) + STOCK_RESUME_STALE_MS });
  assert.equal(fresh.running, true);
  assert.equal(fresh.canResume, false);
  assert.equal(clientActive.running, true);
  assert.equal(clientActive.canResume, false);
});

test("una run running stale espone Riprendi", () => {
  const state = stockResumeUiState(running437, { now: Date.parse(checkpoint) + STOCK_RESUME_STALE_MS });
  assert.equal(state.stale, true);
  assert.equal(state.canResume, true);
  assert.equal(state.running, false);
  assert.equal(state.actionLabel, "Riprendi");
});

test("un click crea una sola richiesta con lo stesso run ID e resume=true", () => {
  const lockRef = { current: null };
  const requests = [];
  if (claimSyncStart(lockRef, "stocks")) {
    requests.push(stockSyncRequestPayload({ offset: 0, syncRunId: running437.id, resume: true }));
  }
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    action: "run_now",
    syncType: "stocks",
    offset: 0,
    batchSize: 12,
    syncRunId: 437,
    resume: true,
    origin: "integrations",
  });
});

test("il lock client accetta un solo click finché la richiesta non termina", () => {
  const lockRef = { current: null };
  let requests = 0;
  if (claimSyncStart(lockRef, "stocks")) requests += 1;
  if (claimSyncStart(lockRef, "stocks")) requests += 1;
  assert.equal(requests, 1);
  assert.equal(lockRef.current, "stocks");
  releaseSyncStart(lockRef, "stocks");
  assert.equal(claimSyncStart(lockRef, "stocks"), true);
});

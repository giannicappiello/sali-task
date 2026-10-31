import test from "node:test";
import assert from "node:assert/strict";
import { stockQueueUiState } from "../src/modules/integrations/services/stockQueueUi.js";
test("past retry is waiting for worker, never a past future attempt", () => {
  const s = stockQueueUiState({status:"retry",available_at:"2026-10-31T01:13:00Z"},Date.parse("2026-10-31T15:00:00Z"));
  assert.equal(s.waiting,true); assert.equal(s.nextAttemptAt,null);
  assert.match(s.phase,/punto salvato/);
});
test("future backoff is scheduled and active execution is not waiting", () => {
  const date="2026-10-31T15:15:00Z";
  assert.equal(stockQueueUiState({status:"retry",available_at:date},Date.parse("2026-10-31T15:00:00Z")).nextAttemptAt,date);
  for (const status of ["leased","running","failed","completed","cancelled"]) {
    assert.equal(stockQueueUiState({status}).waiting,false);
  }
});

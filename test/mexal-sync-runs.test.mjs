import assert from "node:assert/strict";
import { completeSyncRun } from "../api/mexal/lib/syncRuns.js";

const calls = [];
const admin = { from() { return { select() { return { eq() { return { maybeSingle: async () => ({ data: { started_at: "2026-07-19T10:00:00Z" }, error: null }) }; } }; }, update(values) { calls.push(values); return { eq(_column, id) { assert.equal(typeof id, "number"); assert.equal(id, 15); return Promise.resolve({ error: null }); } }; } }; } };
await completeSyncRun(admin, 15, { processed: 1 });
assert.equal(calls[0].status, "completed");
assert.equal(calls[0].processed, 1);
assert.ok(Number.isFinite(calls[0].duration_ms));
console.log("mexal sync runs: runId bigint 15 read and updated without UUID casts");

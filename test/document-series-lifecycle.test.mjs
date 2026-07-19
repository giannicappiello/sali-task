import assert from "node:assert/strict";
import { completeSyncRun, failSyncRun } from "../api/mexal/lib/syncRuns.js";
import { saveRows } from "../api/mexal/sync-document-series.js";

const updates = [];
const lifecycleAdmin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { started_at: "2026-07-19T00:00:00.000Z" }, error: null }) }) }), update: (payload) => ({ eq: async () => { updates.push(payload); return { error: null }; } }) }) };
await completeSyncRun(lifecycleAdmin, 1, { processed: 2 });
await failSyncRun(lifecycleAdmin, 2, "errore controllato");
assert.equal(updates[0].status, "completed", "run chiusa completed");
assert.equal(updates[1].status, "failed", "run chiusa failed");

const queries = [];
const storageAdmin = { from: () => ({ select: () => ({ in: async () => ({ data: [{ source_key: "OCM:OCM:A" }], error: null }) }), upsert: async (rows, options) => { queries.push({ rows, options }); return { error: null }; } }) };
const result = await saveRows(storageAdmin, [{ source_key: "OCM:OCM:A" }, { source_key: "OCX:OCX:B" }]);
assert.deepEqual(result, { inserted: 1, updated: 1 });
assert.equal(queries.length, 1, "solo upsert, nessuna cancellazione dei dati precedenti");
assert.equal(queries[0].options.onConflict, "source_key");
console.log("document-series lifecycle: ok");

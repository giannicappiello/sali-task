import assert from "node:assert/strict";
import { completeSyncRun, failSyncRun } from "../api/mexal/lib/syncRuns.js";
import { saveRows } from "../server/mexal/sync-document-series.js";

const updates = [];
const lifecycleAdmin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { started_at: "2026-07-19T00:00:00.000Z" }, error: null }) }) }), update: (payload) => ({ eq: async () => { updates.push(payload); return { error: null }; } }) }) };
const diagnostics = { endpoint: "https://mexal.example/dati-generali/serie-documenti", http_status: 200, document_count: 2 };
// The API stores diagnostics before its work; failSyncRun must not overwrite them.
updates.push({ metadata: { diagnostics } });
await completeSyncRun(lifecycleAdmin, 1, { processed: 2, inserted: 1, updated: 1 });
await failSyncRun(lifecycleAdmin, 2, "errore controllato");
assert.equal(updates[1].status, "completed", "run chiusa completed");
assert.equal(updates[2].status, "failed", "run chiusa failed");
assert.equal("metadata" in updates[2], false, "failSyncRun non sovrascrive metadata diagnostici");
assert.deepEqual(updates[0].metadata.diagnostics, diagnostics, "diagnostica conservata dopo failSyncRun");

const queries = [];
const storageAdmin = { from: () => ({ select: () => ({ in: async () => ({ data: [{ source_key: "OC:1" }], error: null }) }), upsert: async (rows, options) => { queries.push({ rows, options }); return { error: null }; } }) };
const rows = [{ source_key: "OC:1" }, { source_key: "OX:1" }];
const result = await saveRows(storageAdmin, rows);
assert.deepEqual(result, { inserted: 1, updated: 1 });
assert.equal(queries.length, 1, "solo upsert, nessuna cancellazione dei dati precedenti");
assert.equal(queries[0].options.onConflict, "source_key", "upsert idempotente su source_key");
assert.deepEqual(queries[0].rows, rows);
console.log("document-series lifecycle: ok");

import assert from "node:assert/strict";
import { runRegisteredSync } from "../api/mexal/lib/syncRegistry.js";

const calls = [];
const result = await runRegisteredSync({
  syncType: "products", baseUrl: "https://workspace.test", authorization: "Bearer token",
  fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    return { ok: true, json: async () => body.offset === 0 ? { completato: false, prossimo_offset: 8, sync_run_id: 12 } : { completato: true, prossimo_offset: 10, sync_run_id: 12 } };
  },
});
assert.equal(result.success, true);
assert.deepEqual(calls.map((item) => [item.offset, item.syncRunId || null]), [[0, null], [8, 12]]);
console.log("automation run now: la sincronizzazione prodotti percorre tutti i batch");

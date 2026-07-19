import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [dashboard, service] = await Promise.all([
  readFile("src/modules/integrations/pages/MexalDashboard.jsx", "utf8"),
  readFile("src/modules/integrations/services/mexalSyncService.js", "utf8"),
]);

const labels = ["Clienti", "Prodotti", "Giacenze", "Condizioni commerciali", "Serie documenti", "Sincronizza tutto"];
for (const label of labels) assert.match(dashboard, new RegExp(`"${label}"`));

assert.match(service, /startMexalSync\(syncType\)[\s\S]*action: "run_now", syncType/);
for (const type of ["clients", "commercial_conditions", "document_series"]) {
  assert.match(dashboard, new RegExp(`await startMexalSync\\(${type}\\)|await startMexalSync\\(syncType\\)`));
}
for (const [type, label] of [["clients", "Clienti"], ["products", "Prodotti"], ["stocks", "Giacenze"], ["commercial_conditions", "Condizioni commerciali"], ["document_series", "Serie documenti"]]) {
  assert.match(dashboard, new RegExp(`${type}: "${label}"`));
}
assert.match(dashboard, /syncType === "products"[\s\S]*invokeProductsSync\(updateBatchProgress, \(\) => manualCancelledRef\.current\)/);
assert.match(dashboard, /syncType === "stocks"[\s\S]*invokeStocksSync\(updateBatchProgress, \(\) => manualCancelledRef\.current\)/);
assert.match(service, /syncRunId = data\.sync_run_id \|\| syncRunId[\s\S]*data\.completato[\s\S]*data\.prossimo_offset/);
assert.match(dashboard, /\["clients", "commercial_conditions", "document_series", "products", "stocks"\]/);
assert.match(dashboard, /for \(const \[phaseIndex, phaseType\] of phases\.entries\(\)\)/);
assert.match(dashboard, /await refreshData\(result\.runId \|\| result\.sync_run_id \|\| null\)/);
assert.match(service, /if \(isCancelled\(\)\) throw Object\.assign\(new Error\("Sincronizzazione annullata/);
assert.match(dashboard, /manualCancelledRef\.current = true/);
assert.match(dashboard, /run\.status === "running" && isAdminUser/);
assert.match(dashboard, /Arresta sincronizzazione/);
assert.match(dashboard, /error\.status === 409[\s\S]*È già presente una sincronizzazione in corso/);
assert.match(dashboard, /isAdminUser && <div className="mexal-manual-actions">/);
assert.doesNotMatch(dashboard, />clients<|>products<|>stocks<|>commercial_conditions<|>document_series<|>sync_all</);

console.log("manual Mexal synchronization controls cover starts, conflicts, stop, refresh, and admin visibility");

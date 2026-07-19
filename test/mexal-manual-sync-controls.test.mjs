import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [dashboard, service] = await Promise.all([
  readFile("src/modules/integrations/pages/MexalDashboard.jsx", "utf8"),
  readFile("src/modules/integrations/services/mexalSyncService.js", "utf8"),
]);

const labels = ["Clienti", "Prodotti", "Giacenze", "Condizioni commerciali", "Serie documenti", "Sincronizza tutto"];
for (const label of labels) assert.match(dashboard, new RegExp(`"${label}"`));

assert.match(service, /startMexalSync\(syncType\)[\s\S]*action: "run_now", syncType/);
assert.match(service, /startAllMexalSyncs\(\)[\s\S]*action: "sync_all"/);
for (const [type, label] of [["clients", "Clienti"], ["products", "Prodotti"], ["stocks", "Giacenze"], ["commercial_conditions", "Condizioni commerciali"], ["document_series", "Serie documenti"]]) {
  assert.match(dashboard, new RegExp(`${type}: "${label}"`));
}
assert.match(dashboard, /run\.status === "running" && isAdminUser/);
assert.match(dashboard, /Arresta sincronizzazione/);
assert.match(dashboard, /error\.status === 409[\s\S]*È già presente una sincronizzazione in corso/);
assert.match(dashboard, /await refreshData\(result\.runId \|\| result\.sync_run_id \|\| null\)/);
assert.match(dashboard, /isAdminUser && <div className="mexal-manual-actions">/);
assert.doesNotMatch(dashboard, />clients<|>products<|>stocks<|>commercial_conditions<|>document_series<|>sync_all</);

console.log("manual Mexal synchronization controls cover starts, conflicts, stop, refresh, and admin visibility");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [dashboard, syncCard, agents, history, settings, diagnostics] = await Promise.all([
  readFile("src/modules/integrations/pages/MexalDashboard.jsx", "utf8"),
  readFile("src/modules/integrations/components/MexalSyncCard.jsx", "utf8"),
  readFile("src/modules/integrations/pages/MexalAgents.jsx", "utf8"),
  readFile("src/modules/integrations/components/MexalHistory.jsx", "utf8"),
  readFile("src/modules/integrations/components/MexalSettings.jsx", "utf8"),
  readFile("src/pages/Settings/MexalDiagnostics.jsx", "utf8"),
]);

assert.doesNotMatch(dashboard, /Avvio manuale|mexal-manual-start|Sincronizza tutto/);
assert.match(dashboard, /title: "Provvigioni listini"/);
assert.doesNotMatch(dashboard, /title: "Ordini"/);
assert.match(dashboard, /type: "list_price_commissions"/);
assert.equal((dashboard.match(/type="button" className="mexal-kpi"/g) || []).length, 5);
assert.match(syncCard, /Arresta sincronizzazione/);
assert.match(syncCard, /onStop\?\.\(\)/);
assert.match(agents, /mexal-search-control/);
assert.match(agents, /Sincronizza agenti/);
assert.match(agents, /Arresta sincronizzazione/);
assert.match(agents, /mexal-agents-panel/);
assert.match(history, /Tutte le origini/);
assert.match(history, /Pianificata/);
assert.match(history, /run\.error_message/);
assert.match(settings, /mexal-settings-actions/);
assert.match(settings, /primary-action/);
assert.match(settings, /secondary-action/);
assert.match(diagnostics, /mexal-diagnostics-page/);
assert.doesNotMatch(diagnostics, /orders-secondary/);

console.log("modifiche UI Mexal del 24/7 verificate");

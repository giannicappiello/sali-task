import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [dashboard, card, sync] = await Promise.all([
  readFile("src/modules/integrations/pages/MexalDashboard.jsx", "utf8"),
  readFile("src/modules/integrations/components/MexalSyncCard.jsx", "utf8"),
  readFile("server/mexal/sync-order-documents.js", "utf8"),
]);

assert.match(dashboard, /title: "Ordini"/);
assert.match(dashboard, /OCM, OCI e OCX/);
assert.match(dashboard, /actionLabel: "Esegui ora"/);
assert.match(dashboard, /onStop=\{\(\) => stopRun\(card\.lastRunData\)\}/);
assert.match(card, /actionLabel \|\| "Sincronizza"/);
assert.match(card, /Arresta sincronizzazione/);
assert.match(sync, /runStatus\(supabase, run\.id\) !== "running"/);
assert.match(sync, /cancelled/);

console.log("card Ordini: esecuzione manuale e arresto verificati");

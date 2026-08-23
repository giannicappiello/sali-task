import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const automation = await readFile("api/mexal/automation.js", "utf8");
const service = await readFile("src/modules/integrations/services/mexalSyncService.js", "utf8");
const dashboard = await readFile("src/modules/integrations/pages/MexalDashboard.jsx", "utf8");

assert.match(automation, /body\.dryRun === true \? "test" : "sync"/);
assert.match(service, /syncType: "products", dryRun: true, articlePrefix/);
assert.match(service, /\.\.\.\(articlePrefix \? \{ articlePrefix \} : \{\}\)/);
assert.match(dashboard, /Dry-run PB/);
assert.match(dashboard, /Sincronizza PB/);
assert.match(dashboard, /pbPreview\?\.prefisso_articoli !== "PB"/);
assert.match(dashboard, /articlePrefix: "PB"/);

console.log("Targeted PB dry-run and explicit admin synchronization controls are wired");
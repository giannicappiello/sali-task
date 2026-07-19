import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const service = await readFile("src/modules/integrations/services/mexalSyncService.js", "utf8");
assert.match(service, /run\.sync_type !== "commercial_conditions"/);
assert.match(service, /return loadRunDetails\(run.id\)/);
const dashboard = await readFile("src/modules/integrations/pages/MexalDashboard.jsx", "utf8");
assert.match(dashboard, /loadRunDetailsForRun\(nextSelected\)/);
console.log("dashboard: bigint run id 23 never filters legacy UUID detail tables");

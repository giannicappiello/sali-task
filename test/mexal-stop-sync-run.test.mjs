import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [api, dashboard, products, clients] = await Promise.all([
  readFile("api/mexal/stop-sync-run.js", "utf8"),
  readFile("src/modules/integrations/pages/MexalDashboard.jsx", "utf8"),
  readFile("api/mexal/sync-products.js", "utf8"),
  readFile("api/mexal/sync-clients.js", "utf8"),
]);
assert.match(api, /status: "failed"/);
assert.match(api, /completed_at: stoppedAt/);
assert.match(api, /stopped_manually: true/);
assert.match(api, /eq\("status", "running"\)/);
assert.match(dashboard, /ARRESTA SINCRONIZZAZIONE/);
assert.match(dashboard, /run\.status === "running" && isAdminUser/);
assert.match(dashboard, /stoppingRunId === run\.id/);
assert.match(products, /assertRunStillRunning/);
assert.match(clients, /assertRunStillRunning/);
console.log("manual stop closes only running runs and guards subsequent batches");

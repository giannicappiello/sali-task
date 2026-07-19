import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [api, lifecycle, dashboard, products, clients] = await Promise.all([
  readFile("server/mexal/stop-sync-run.js", "utf8"),
  readFile("api/mexal/lib/syncRuns.js", "utf8"),
  readFile("src/modules/integrations/pages/MexalDashboard.jsx", "utf8"),
  readFile("server/mexal/sync-products.js", "utf8"),
  readFile("server/mexal/sync-clients.js", "utf8"),
]);
assert.match(api, /cancelSyncRun/);
assert.match(api, /isSyncRunClosedError[\s\S]*status\(409\)/);
assert.match(lifecycle, /"cancelled"/);
assert.match(api, /stopped_manually: true/);
assert.match(dashboard, /ARRESTA SINCRONIZZAZIONE/);
assert.match(dashboard, /run\.status === "running" && isAdminUser/);
assert.match(dashboard, /stoppingRunId === run\.id/);
assert.match(products, /assertRunStillRunning/);
assert.match(clients, /assertRunStillRunning/);
console.log("manual stop closes only running runs and guards subsequent batches");

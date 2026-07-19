import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, lifecycle, stopEndpoint, badge] = await Promise.all([
  readFile("supabase/migrations/20260720170000_fix_mexal_sync_runs_status_constraint.sql", "utf8"),
  readFile("api/mexal/lib/syncRuns.js", "utf8"),
  readFile("server/mexal/stop-sync-run.js", "utf8"),
  readFile("src/modules/integrations/components/IntegrationStatusBadge.jsx", "utf8"),
]);

assert.match(migration, /alter table public\.mexal_sync_runs\s+drop constraint if exists mexal_sync_runs_status_check/i);
for (const status of ["running", "completed", "failed", "cancelled", "timeout"]) {
  assert.match(migration, new RegExp(`['"]${status}['"]`), `il constraint accetta ${status}`);
}
assert.doesNotMatch(migration, /(?:create|drop)\s+table/i, "la migrazione non ricrea né elimina tabelle");
assert.doesNotMatch(migration, /public\.(?!mexal_sync_runs\b)[a-z_]+/i, "la migrazione non modifica tabelle estranee");
assert.match(lifecycle, /cancelSyncRun[\s\S]*?"cancelled"/);
assert.match(lifecycle, /timeoutSyncRun[\s\S]*?"timeout"/);
assert.match(stopEndpoint, /cancelSyncRun/);
assert.match(stopEndpoint, /status\(200\)\.json\(\{ run: data/);
assert.match(stopEndpoint, /completed_at/);
assert.match(stopEndpoint, /stopped_manually: true/);
assert.match(badge, /cancelled:\s*"Annullata"/);
assert.match(badge, /timeout:\s*"Tempo scaduto"/);
console.log("mexal sync run status constraint supports lifecycle terminal states");

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationUrl = new URL("../../supabase/migrations/20260827143000_enqueue_workbench_oct_refresh.sql", import.meta.url);
const apiUrl = new URL("../../api/mexal/automation.js", import.meta.url);
const uiUrl = new URL("../../src/pages/Production/RdpWorkbench.jsx", import.meta.url);

test("il refresh Workbench accoda oct_orders nel queue worker con lock globale", () => {
  const migration = fs.readFileSync(migrationUrl, "utf8");
  assert.match(migration, /create or replace function public\.enqueue_workbench_oct_refresh/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /sync_type = 'oct_orders'/i);
  assert.match(migration, /status in \('queued', 'leased', 'running', 'retry'\)/i);
  assert.match(migration, /insert into public\.mexal_sync_jobs/i);
  assert.match(migration, /'trigger', 'workbench_open'/i);
  assert.match(migration, /on conflict \(cycle_id, schedule_id\) do nothing/i);
  assert.doesNotMatch(migration, /syncOctOrders|sync-oct-orders/i);
});

test("l'RPC è service-role only e fallisce se lo schedule OCT è disabilitato", () => {
  const migration = fs.readFileSync(migrationUrl, "utf8");
  assert.match(migration, /and enabled = true/i);
  assert.match(migration, /OCT_SYNC_NOT_ENABLED/i);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
});

test("API e UI avviano il refresh in background e seguono soltanto job OCT", () => {
  const api = fs.readFileSync(apiUrl, "utf8");
  const ui = fs.readFileSync(uiUrl, "utf8");
  assert.match(api, /case "progremes_oct_refresh"[\s\S]*createAdmin\(req, "rdp\.view"\)/i);
  assert.match(api, /enqueue_workbench_oct_refresh/i);
  assert.match(api, /case "progremes_oct_refresh_status"[\s\S]*\.eq\("sync_type", "oct_orders"\)/i);
  assert.match(ui, /callWorkbench\(accessToken, "progremes_workbench_list"\)/i);
  assert.match(ui, /callWorkbench\(accessToken, "progremes_oct_refresh"\)/i);
  assert.match(ui, /Sincronizzazione OCT in background/i);
  assert.match(ui, /progremes_oct_refresh_status/i);
});

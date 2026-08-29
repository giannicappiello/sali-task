import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/20260828120000_workspacemes_v3_end_to_end.sql", import.meta.url);
const previewAmbiguityMigrationUrl = new URL("../supabase/migrations/20260829223000_fix_workspace_v3_preview_id_ambiguity.sql", import.meta.url);

test("migration V3 è additiva, fail-closed e preserva v1/v2", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of ["workspace_finished_bom_revisions", "workspace_finished_bom_lines", "workspace_supplier_order_snapshots", "workspace_supplier_order_snapshot_lines", "workspace_v3_previews", "workspace_v3_preview_sources", "workspace_v3_confirmation_sagas", "workspace_v3_material_commitments", "workspace_v3_purchase_requirements", "workspace_v3_purchase_documents", "workspace_v3_outbox", "workspace_v3_audit"]) assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(sql, /workspacemes\.v3\.preview', false/);
  assert.match(sql, /workspacemes\.v3\.confirm', false/);
  assert.match(sql, /legacy\.sync\.finished_bom/);
  assert.match(sql, /legacy\.sync\.fp_formulas/);
  assert.match(sql, /V3_IDEMPOTENCY_CONFLICT/);
  assert.match(sql, /V3_CONCURRENT_MODIFICATION/);
  assert.match(sql, /NOT_EXPOSED_BY_MEXAL_ENDPOINT/);
  assert.match(sql, /apply_workspace_finished_bom_snapshot/);
  assert.match(sql, /apply_workspace_supplier_order_snapshot/);
  assert.match(sql, /create_workspace_v3_purchase_document/);
  assert.match(sql, /SupplierOrderPreparedNotSent/);
  assert.match(sql, /purchases\.manage/);
  assert.doesNotMatch(sql, /drop\s+(?:table|column|schema)/i);
  assert.doesNotMatch(sql, /delete\s+from/i);
  assert.doesNotMatch(sql, /update\s+public\.workspace_production_/i);
});

test("persist preview V3 qualifica preview_id e gli altri nomi collidenti", async () => {
  const sql = await readFile(previewAmbiguityMigrationUrl, "utf8");
  assert.match(sql, /preview_component\.preview_id\s*=\s*v_preview\.id/);
  assert.match(sql, /preview_component\.component_kind\s*=\s*'FORMULA_COMPONENT'/);
  assert.match(sql, /preview_component\.bom_line_id\s*=\s*\(v_item->>'bomLineId'\)::bigint/);
  assert.doesNotMatch(sql, /\bwhere\s+preview_id\s*=\s*v_preview\.id/i);
  assert.match(sql, /grant execute on function public\.persist_workspace_v3_preview[\s\S]*to service_role/i);
});

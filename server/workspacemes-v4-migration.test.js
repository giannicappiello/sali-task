import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fullFlowMigration = new URL("../supabase/migrations/20260829234500_workspacemes_v4_full_mes.sql", import.meta.url);
const ambiguityFixMigration = new URL(
  "../supabase/migrations/20260830102500_fix_workspace_v4_snapshot_hash_ambiguity.sql",
  import.meta.url,
);

test("migration V4 conserva solo mirror MES e fabbisogni acquisto Workspace", async () => {
  const sql = await readFile(fullFlowMigration, "utf8");
  for (const table of ["workspace_v4_previews", "workspace_v4_preview_materials", "workspace_v4_confirmation_mirrors", "workspace_v4_purchase_requirements"])
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, "i"));
  assert.doesNotMatch(sql, /workspace_v4_material_commitments/i);
  assert.match(sql, /alter column contract_version set default 4/i);
  assert.match(sql, /'MES_V4_AUTHORITATIVE'/i);
  assert.match(sql, /update public\.workspace_v3_feature_flags set enabled=false/i);
});

test("conferma V4 genera acquisti soltanto dalle shortage certificate MES", async () => {
  const sql = await readFile(fullFlowMigration, "utf8");
  assert.match(sql, /workspace_v4_preview_materials where preview_id=p_preview_id and shortage_quantity>0/i);
  assert.match(sql, /'certifiedHash',v_material\.certified_hash/i);
});

test("la funzione V4 qualifica snapshot_hash e le colonne della richiesta", async () => {
  const migration = await readFile(ambiguityFixMigration, "utf8");
  assert.match(migration, /demand_snapshot\.snapshot_hash\s*=\s*p_snapshot_hash/);
  assert.match(migration, /production_request\.idempotency_key\s*=\s*p_idempotency_key/);
  assert.doesNotMatch(migration, /\band\s+snapshot_hash\s*=\s*p_snapshot_hash/);
  assert.doesNotMatch(migration, /\bwhere\s+idempotency_key\s*=\s*p_idempotency_key/);
});

test("la migration V4 conserva la funzione protetta e non contiene operazioni distruttive", async () => {
  const migration = await readFile(ambiguityFixMigration, "utf8");
  assert.match(migration, /security definer/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /\bdrop\b/i);
  assert.doesNotMatch(migration, /\bdelete\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
});

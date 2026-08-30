import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = new URL("../supabase/migrations/20260829234500_workspacemes_v4_full_mes.sql", import.meta.url);

test("migration V4 conserva solo mirror MES e fabbisogni acquisto Workspace", async () => {
  const sql = await readFile(migration, "utf8");
  for (const table of ["workspace_v4_previews", "workspace_v4_preview_materials", "workspace_v4_confirmation_mirrors", "workspace_v4_purchase_requirements"])
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, "i"));
  assert.doesNotMatch(sql, /workspace_v4_material_commitments/i);
  assert.match(sql, /alter column contract_version set default 4/i);
  assert.match(sql, /'MES_V4_AUTHORITATIVE'/i);
  assert.match(sql, /update public\.workspace_v3_feature_flags set enabled=false/i);
});

test("conferma V4 genera acquisti soltanto dalle shortage certificate MES", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /workspace_v4_preview_materials where preview_id=p_preview_id and shortage_quantity>0/i);
  assert.match(sql, /'certifiedHash',v_material\.certified_hash/i);
});

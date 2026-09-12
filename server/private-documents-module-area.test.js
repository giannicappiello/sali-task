import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("private documents keeps its route without overwriting the selected area", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260912110000_preserve_private_documents_module_area.sql", import.meta.url), "utf8");
  assert.match(sql, /create or replace function public.enforce_workspace_private_documents_module\(\)/i);
  assert.doesNotMatch(sql, /new\.area\s*:=/i);
  assert.match(sql, /new\.percorso := '\/documentation\/private'/);
  assert.match(sql, /new\.provider := 'workspace'/);
  assert.doesNotMatch(sql, /(?:update|delete from|insert into)\s+public\./i);
});

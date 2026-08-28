import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("la migration Magazzino e additiva e registra modulo, schermata e costo", async () => {
  const sql = await readFile("supabase/migrations/20260828223000_workspace_warehouse_module.sql", "utf8");
  assert.match(sql, /add column if not exists costo_ultimo/i);
  assert.match(sql, /costo_ult.*cos_ult/is);
  assert.match(sql, /'magazzino','Magazzino'/);
  assert.match(sql, /workspace_moduli_schermate/);
  assert.doesNotMatch(sql, /drop\s+(table|column)|delete\s+from\s+public\.prodotti/i);
});

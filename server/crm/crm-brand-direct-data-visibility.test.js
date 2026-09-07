import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../../supabase/migrations/20260907120000_fix_brand_direct_virtual_customer_visibility.sql", import.meta.url),
  "utf8",
);

test("authorized BRAND DIRECT roles can resolve only the canonical virtual customer", () => {
  assert.match(migration, /id = '00000000-0000-4000-8000-000000000001'::uuid/);
  assert.match(migration, /tipo = 'brand_direct'/);
  assert.match(migration, /crm_has_module_level\('crm_brand_direct', 'lettura'\)/);
  assert.match(migration, /or public\.crm_row_visible\(/);
});

test("the visibility repair does not mutate CRM, project, or task data", () => {
  assert.doesNotMatch(migration, /\b(?:insert|update|delete|truncate)\b\s+(?:into\s+|from\s+)?public\./i);
  assert.doesNotMatch(migration, /public\.v4_(?:progetti|fasi_progetto)/i);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../../supabase/migrations/20260907110000_fix_crm_brand_direct_role_access.sql", import.meta.url),
  "utf8",
);

test("CRM BRAND DIRECT accepts an explicit role grant without bypassing area or personal denies", () => {
  assert.match(migration, /select u\.id,u\.ruolo_id/);
  assert.match(migration, /target_module='crm_brand_direct' and exists\(/);
  assert.match(migration, /role_module\.ruolo_id=t\.ruolo_id and role_module\.modulo=target_module/);

  const areaGate = migration.indexOf("when m.area is not null");
  const roleGrant = migration.indexOf("when target_module='crm_brand_direct'");
  const personalDeny = migration.indexOf("when (select decisione from exception)='nega'");
  assert.ok(personalDeny >= 0 && personalDeny < roleGrant);
  assert.ok(areaGate >= 0 && areaGate < roleGrant);
});

test("the role grant remains scoped to CRM BRAND DIRECT", () => {
  assert.doesNotMatch(migration, /when exists\(\s*select 1 from public\.ruoli_moduli/);
  assert.match(migration, /when target_module='crm_brand_direct' and exists\(/);
});

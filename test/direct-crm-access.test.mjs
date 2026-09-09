import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INDEPENDENT_DIRECT_MODULES, ONLINE_CHANNEL_MODULES, requiresDirectModuleGrant } from "../src/config/directCrmAccess.js";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const sql = read("supabase/migrations/20260909160000_independent_direct_crm_access.sql");
const auth = read("src/contexts/AuthContext.jsx");
const guard = read("src/components/WorkspaceAccessGuard.jsx");
const inspector = read("src/pages/Settings/AccessCheck.jsx");

test("three DIRECT channels require distinct grants, not their container", () => {
  assert.deepEqual(INDEPENDENT_DIRECT_MODULES, ["crm_brand_direct", "crm_b2b", "crm_online"]);
  for (const code of [...INDEPENDENT_DIRECT_MODULES, ...ONLINE_CHANNEL_MODULES]) assert.equal(requiresDirectModuleGrant(code), true);
  for (const code of ["crm_direct", "crm", "crm_conto_terzi", "attivita", null, "crm_online_unknown"]) assert.equal(requiresDirectModuleGrant(code), false);
});

test("database removes cross-grants without deleting assignments or operational history", () => {
  assert.match(sql, /dipendenze='\{\}', dipendenze_alternative='\{\}'/);
  assert.match(sql, /target_module in \('crm_brand_direct','crm_b2b','crm_online'\) then exists/);
  const decision = sql.split("create or replace function public.workspace_inspect_module_access")[0];
  assert.doesNotMatch(decision, /public\.ruoli_moduli/);
  assert.doesNotMatch(sql, /\b(delete|truncate|drop)\b/i);
  assert.deepEqual([...sql.matchAll(/\bupdate public\.(\w+)/g)].map((m) => m[1]), ["workspace_moduli", "workspace_moduli"]);
  assert.doesNotMatch(sql, /insert into public\./);
});

test("the Online parent check runs before personal child grants", () => {
  assert.ok(sql.indexOf("and not public.workspace_module_enabled_for_user(target_user_id,'crm_online')") < sql.indexOf("(select decisione from exception)='consenti'"));
  assert.match(sql, /when t\.is_admin then true/);
  assert.match(sql, /decisione from exception\)='nega' then false/);
  assert.match(sql, /u\.attivo is not false/);
});

test("frontend fails closed and screen exceptions cannot enable a different CRM channel", () => {
  assert.match(auth, /if \(requiresDirectModuleGrant\(moduleCode\)\) return moduleAccess\.includes\(moduleCode\)/);
  assert.match(auth, /nextModuleAccess\.filter\(\(code\) => !requiresDirectModuleGrant\(code\)\)/);
  assert.match(auth, /requiresDirectModuleGrant\(moduleCode\) && !hasModuleAccess\(moduleCode\)/);
  assert.match(guard, /screenGranted && !requiresDirectModuleGrant\(moduleCode\)/);
});

test("admin inspector delegates to effective SQL access, rejects unauthorized callers and stale responses", () => {
  assert.match(sql, /if not coalesce\(public\.workspace_user_is_admin\(\),false\)/);
  assert.match(sql, /using errcode='42501'/);
  assert.match(sql, /public\.workspace_module_enabled_for_user\(u\.id,m\.codice\) as enabled/);
  assert.match(inspector, /supabase\.rpc\("workspace_inspect_module_access"/);
  assert.match(inspector, /moduleAudit\.userId === selectedId/);
  assert.match(inspector, /if \(!cancelled\) setModuleAudit/);
  assert.doesNotMatch(inspector, /const inheritedModules|const aiRoleBlocked/);
});

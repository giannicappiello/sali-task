import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/20260912170000_department_commercial_data_scope.sql");
const edge = read("../supabase/functions/report-giornate-api/index.ts");
const beautyFunction = edge.slice(edge.indexOf("async function loadOrganizationScope("), edge.indexOf("\nfunction applyOrganizationScope"));
const loadScope = new Function(beautyFunction.replaceAll(": any", "").replaceAll(": boolean", "") + "; return loadOrganizationScope;")();

function clients(scope, { error = null, links = [] } = {}) {
  const calls = [];
  const primary = { from(table) {
    calls.push(["from", table]);
    const query = {};
    for (const method of ["select", "eq", "or", "not"]) query[method] = (...args) => { calls.push([method, ...args]); return query; };
    query.then = resolve => resolve({ data: links, error: null });
    return query;
  } };
  const scoped = { rpc(name) { calls.push(["rpc", name]); return Promise.resolve({ data: scope, error }); } };
  return { primary, scoped, calls };
}

test("BeautyDays uses the caller JWT scope, including consultants in department membership", async () => {
  const c = clients({ mode: "team", agent_ids: ["agent-a", "agent-b"], user_ids: ["colleague"] },
    { links: [{ external_beauty_id: "beauty" }] });
  const result = await loadScope(c.primary, c.scoped, {}, false);
  assert.deepEqual(result.visibleAgentIds, ["agent-a", "agent-b"]);
  assert.deepEqual(result.visibleBeautyIds, ["beauty"]);
  assert.deepEqual(c.calls[0], ["rpc", "workspace_data_scope"]);
  assert.ok(c.calls.some(call => call[0] === "or" && call[1].includes("utente_id.in.(colleague)")));
});
test("scope failures fail closed, never reuse legacy agent assignments", async () => {
  const c = clients(null, { error: new Error("offline") });
  await assert.rejects(loadScope(c.primary, c.scoped, { mexal_agente_id: "stale" }, false), /offline/);
  assert.equal(c.calls.length, 1);
});
test("department removal immediately yields empty scope; own consultant remains personal", async () => {
  const c = clients({ mode: "team", agent_ids: [], user_ids: [] });
  const result = await loadScope(c.primary, c.scoped, { external_beauty_id: "self" }, false);
  assert.deepEqual(result.visibleAgentIds, []);
  assert.deepEqual(result.visibleBeautyIds, ["self"]);
  assert.equal(c.calls.length, 1);
});
test("own-data scope does not expand consultant lookup to colleagues", async () => {
  const c = clients({ mode: "propri", agent_ids: ["self"], user_ids: ["self-user"] });
  await loadScope(c.primary, c.scoped, {}, false);
  assert.ok(c.calls.some(call => call[0] === "or" && call[1] === "mexal_agente_id.in.(self)"));
});
test("admin scope retains bypass without requesting a fake service-role user scope", async () => {
  assert.deepEqual(await loadScope(null, null, {}, true),
    { mode: "tutti", visibleAgentIds: null, visibleBeautyIds: null });
});
test("orders backoffice cannot bypass organizational scope and reloads after membership changes", () => {
  const code = read("../src/modules/orders/pages/useOrdersAccess.js");
  assert.match(code, /canSeeAll: isAdmin \|\| \(isBackoffice && scopeMode === "tutti"\)/);
  assert.match(code, /customerCode, scopeMode, scopeAgentKey, moduleDefinition.integrationCode/);
  assert.match(code, /enabled = access.enabled === true && canReadModule/);
});
test("SQL scope is canonical, active-only, customer-safe and reused by agent visibility", () => {
  const scope = migration.slice(0, migration.indexOf("create or replace function public.visible_mexal_agent_ids"));
  assert.doesNotMatch(scope, /profile\.reparto_id|u\.reparto_id/);
  assert.match(scope, /u\.attivo is not false/);
  assert.match(scope, /a\.attivo_mexal is not false/);
  assert.match(scope, /d\.attivo is not false/);
  assert.match(scope, /when customer_code is not null then 'cliente'/);
  assert.match(scope, /i\.enabled is true/);
  assert.match(migration, /jsonb_array_elements_text\(public.workspace_data_scope\(\)->'agent_ids'\)/);
  assert.match(migration, /crm_has_module_level\(target_module, 'lettura'\)/);
  assert.match(migration, /department_id is null and data->'user_ids'/);
  assert.match(migration, /as restrictive for all to authenticated/);
});
test("BeautyDays operation controls use permission level, not the obsolete agent label", () => {
  for (const file of ["Giornate", "Report"]) {
    assert.match(read(`../src/modules/pharmacy/pages/${file}.jsx`),
      /solaLettura = !\["write", "admin"\].includes\(utente\?\.access_level\)/);
  }
});

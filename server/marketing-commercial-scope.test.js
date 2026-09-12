import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
const sql = read("../supabase/migrations/20260912190000_marketing_director_commercial_visibility.sql");
const auth = read("../src/contexts/AuthContext.jsx");
const orders = read("../src/modules/orders/pages/useOrdersAccess.js");

test("commercial rule requires a mapped role AND a current active department", () => {
  assert.match(sql, /rule.role_id=u.ruolo_id/);
  assert.match(sql, /ur.utente_id=u.id and ur.reparto_id=rule.department_id/);
  assert.match(sql, /d.attivo is not false/);
  assert.match(sql, /u.attivo is not false/);
  assert.match(sql, /not exists \(select 1 from public.workspace_customer_user_links/);
  assert.match(sql, /lower\(btrim\(r.nome\)\)='direzione'/);
  assert.doesNotMatch(sql, /update public.utenti|update public.ruoli|Criscitiello|Merino/);
});
test("operational mode and commercial mode remain separate on the client", () => {
  assert.match(auth, /commercialMode: scope.commercial_mode \|\| scope.mode \|\| "propri"/);
  assert.match(auth, /if \(isAdmin\(\) \|\| dataScope.mode === "tutti"\) return true/);
  assert.doesNotMatch(auth, /if \(.*dataScope.commercialMode.*return true/);
});
test("commercial read-all neither grants screens nor globally elevates writes", () => {
  assert.match(orders, /canReadAllCommercial = !isCustomer && enabled && commercialMode === "tutti"/);
  assert.match(orders, /enabled = access.enabled === true && canReadModule/);
  assert.match(orders, /canWriteAll: !isCustomer && canWriteModule && \(isAdmin \|\| \(isBackoffice && scopeMode === "tutti"\)\)/);
  assert.match(sql, /data->'agent_ids' \? a.id::text/);
  assert.match(sql, /'insert','update','delete'/);
  assert.match(sql, /h.id=ordine_id and public.workspace_team_agent_visible\(h.codice_agente_mexal\)/);
});
test("only commercial read-all can bypass agent restrictions, including unassigned sales", () => {
  assert.match(sql, /workspace_data_scope\(\)->>'commercial_mode'='tutti'/);
  assert.match(sql, /as restrictive for select to authenticated/);
  assert.match(sql, /for each statement execute function public.workspace_touch_access_revision/);
});

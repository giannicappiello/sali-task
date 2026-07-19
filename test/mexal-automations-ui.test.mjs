import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { loadMexalAutomationRules, saveMexalAutomationRule } from "../src/modules/integrations/services/mexalAutomationService.js";

const supabase = { auth: { getSession: async () => ({ data: { session: { access_token: "access-token" } }, error: null }) } };

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test("loads schedules and event automations with rules_get", async () => {
  const calls = [];
  const result = await loadMexalAutomationRules({ supabase, fetchImpl: async (...args) => {
    calls.push(args);
    return response({ schedules: [{ id: 1, sync_type: "products" }], events: [{ id: 2, event_key: "before_order_save" }] });
  } });
  assert.deepEqual(result.schedules, [{ id: 1, sync_type: "products" }]);
  assert.deepEqual(result.events, [{ id: 2, event_key: "before_order_save" }]);
  assert.equal(calls[0][0], "/api/mexal/automation");
  assert.deepEqual(JSON.parse(calls[0][1].body), { action: "rules_get" });
  assert.equal(calls[0][1].headers.Authorization, "Bearer access-token");
});

test("saves a rule with rules_save and can reload updated rules", async () => {
  const bodies = [];
  const fetchImpl = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return bodies.length === 1
      ? response({ rule: { id: 1, sync_type: "products", enabled: false } })
      : response({ schedules: [{ id: 1, sync_type: "products", enabled: false }], events: [] });
  };
  await saveMexalAutomationRule({ supabase, ruleType: "schedule", rule: { id: 1, enabled: false }, fetchImpl });
  const rules = await loadMexalAutomationRules({ supabase, fetchImpl });
  assert.deepEqual(bodies, [
    { action: "rules_save", ruleType: "schedule", rule: { id: 1, enabled: false } },
    { action: "rules_get" },
  ]);
  assert.equal(rules.schedules[0].enabled, false);
});

test("reports API errors clearly", async () => {
  await assert.rejects(() => loadMexalAutomationRules({ supabase, fetchImpl: async () => response({ error: "Accesso negato" }, 403) }), /Accesso negato/);
});

test("automation UI renders both rule lists and keeps controls admin-only", async () => {
  const source = await readFile(new URL("../src/modules/integrations/components/MexalAutomations.jsx", import.meta.url), "utf8");
  assert.match(source, /Pianificazioni/);
  assert.match(source, /Automazioni evento/);
  assert.match(source, /canManage/);
  assert.match(source, /Nuova pianificazione/);
  assert.match(source, /Nuova automazione evento/);
});

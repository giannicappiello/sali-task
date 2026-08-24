import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { automationSection, canManageMexalAutomations, loadMexalAutomationRules, runOctPrecheck, saveMexalAutomationRule } from "../src/modules/integrations/services/mexalAutomationService.js";

const orderModuleSettings = fs.readFileSync(new URL("../src/modules/integrations/components/OrderModuleSettings.jsx", import.meta.url), "utf8");
const orderEmailTemplate = fs.readFileSync(new URL("../server/orders/order-email-template.js", import.meta.url), "utf8");
const integrationsCss = fs.readFileSync(new URL("../src/modules/integrations/integrations.css", import.meta.url), "utf8");
const mexalAutomations = fs.readFileSync(new URL("../src/modules/integrations/components/MexalAutomations.jsx", import.meta.url), "utf8");

test("the order module configuration exposes a visible save action", () => {
  assert.match(orderModuleSettings, /Salva configurazione/);
  assert.match(orderModuleSettings, /Cliente/);
  assert.match(orderModuleSettings, /Agente/);
  assert.match(orderModuleSettings, /Backoffice e responsabile/);
  assert.match(orderEmailTemplate, /email_cliente_oggetto_template/);
  assert.match(orderEmailTemplate, /email_agente_corpo_template/);
  assert.match(orderEmailTemplate, /email_backoffice_corpo_template/);
  assert.match(orderModuleSettings, /<textarea/);
  assert.match(orderModuleSettings, /ORDER_EMAIL_PLACEHOLDERS/);
  assert.match(orderModuleSettings, /validateOrderEmailTemplate/);
  for (const placeholder of ["cliente", "numero_ordine", "data", "agente", "totale"]) {
    assert.match(orderEmailTemplate, new RegExp(`\\{${placeholder}\\}`));
  }
  assert.match(orderEmailTemplate, /placeholder non supportati/);
  assert.match(integrationsCss, /\.mexal-table-panel \.orders-primary\{background:#126bff;color:#fff/);
});

const supabase = { auth: { getSession: async () => ({ data: { session: { access_token: "access-token" } }, error: null }) } };

function response(payload, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }

test("loads schedules and event automations with rules_get", async () => {
  const calls = [];
  const result = await loadMexalAutomationRules({ supabase, fetchImpl: async (...args) => { calls.push(args); return response({ schedules: [{ id: 1, sync_type: "products" }], events: [{ id: 2, event_key: "before_order_save" }] }); } });
  assert.equal(result.schedules[0].sync_type, "products");
  assert.equal(result.events[0].event_key, "before_order_save");
  assert.deepEqual(JSON.parse(calls[0][1].body), { action: "rules_get" });
  assert.equal(calls[0][1].headers.Authorization, "Bearer access-token");
});

test("schedule section permits only existing schedule types and has five aligned columns", () => {
  const schedule = automationSection("schedule", true);
  assert.equal(schedule.canCreate, false);
  assert.deepEqual(schedule.syncTypes, ["clients", "agents", "products", "commercial_conditions", "document_series", "stocks", "list_price_commissions", "orders", "sales_invoices", "oct_orders"]);
  assert.equal(schedule.columns.length, 5);
  assert.deepEqual(schedule.columns, ["Tipo sincronizzazione", "Frequenza", "Ordine", "Stato", "Azioni"]);
});

test("event section can create rules and retains agents and payments", () => {
  const event = automationSection("event", true);
  assert.equal(event.canCreate, true);
  assert.ok(event.syncTypes.includes("agents"));
  assert.ok(event.syncTypes.includes("payments"));
  assert.equal(event.columns.length, 5);
  assert.deepEqual(event.columns, ["Evento", "Tipo sincronizzazione", "Ordine", "Stato", "Azioni"]);
});

test("non-admins receive no automation controls", () => {
  assert.equal(canManageMexalAutomations(false), false);
  assert.equal(automationSection("schedule", false).canCreate, false);
  assert.equal(automationSection("event", false).canCreate, false);
});

test("saves and toggles an existing schedule with rules_save", async () => {
  const bodies = [];
  const fetchImpl = async (_url, options) => { bodies.push(JSON.parse(options.body)); return response({ rule: { id: 1, sync_type: "products", enabled: false } }); };
  await saveMexalAutomationRule({ supabase, ruleType: "schedule", rule: { id: 1, sync_type: "products", enabled: false }, fetchImpl });
  assert.deepEqual(bodies, [{ action: "rules_save", ruleType: "schedule", rule: { id: 1, sync_type: "products", enabled: false } }]);
});

test("creates a new event automation with rules_save", async () => {
  const bodies = [];
  const rule = { event_key: "manual", sync_type: "agents", scope: "global", enabled: false, execution_order: 1, blocking: false };
  await saveMexalAutomationRule({ supabase, ruleType: "event", rule, fetchImpl: async (_url, options) => { bodies.push(JSON.parse(options.body)); return response({ rule: { id: 9, ...rule } }); } });
  assert.deepEqual(bodies, [{ action: "rules_save", ruleType: "event", rule }]);
});

test("reports API errors clearly", async () => {
  await assert.rejects(() => loadMexalAutomationRules({ supabase, fetchImpl: async () => response({ error: "Accesso negato" }, 403) }), /Accesso negato/);
});

test("admin OCT precheck uses only the dedicated read-only action", async () => {
  const bodies = [];
  const result = await runOctPrecheck({
    supabase,
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return response({ dry_run: true, read_only: true, candidate_oct_count: 1 });
    },
  });

  assert.deepEqual(bodies, [{ action: "oct_precheck" }]);
  assert.equal(result.read_only, true);
  assert.match(mexalAutomations, />Precheck OCT</);
});

test("admin OCT precheck rejects responses that do not confirm read-only mode", async () => {
  await assert.rejects(() => runOctPrecheck({
    supabase,
    fetchImpl: async () => response({ dry_run: false, read_only: false }),
  }), /modalità read-only/);
});

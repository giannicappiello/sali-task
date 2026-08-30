import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyMexalCustomer, summarizeCustomers } from "../../scripts/simulate-crm-customer-classification.mjs";

const migration = readFileSync(new URL("../../supabase/migrations/20260830120000_mexal_active_clients_crm_hierarchy.sql", import.meta.url), "utf8");

test("classifica soltanto le combinazioni Mexal previste", () => {
  assert.equal(classifyMexalCustomer({ cod_alternativo: " private " }), "conto_terzi");
  assert.equal(classifyMexalCustomer({ cod_alternativo: "DIRECT", nome_ricerca_cf: "BtoB" }), "b2b");
  assert.equal(classifyMexalCustomer({ cod_alternativo: "direct", nome_ricerca_cf: "btoc" }), "online");
  assert.equal(classifyMexalCustomer({ cod_alternativo: "DIRECT" }), null);
  assert.equal(classifyMexalCustomer({ cod_alternativo: "ALTRO", nome_ricerca_cf: "BtoB" }), null);
});

test("la simulazione separa PRIVATE, DIRECT BtoB, DIRECT BtoC e non classificati", () => {
  const summary = summarizeCustomers([
    { codice_cliente: "1", cod_alternativo: "PRIVATE" },
    { codice_cliente: "2", cod_alternativo: "DIRECT", nome_ricerca_cf: "BtoB" },
    { codice_cliente: "3", cod_alternativo: "DIRECT", nome_ricerca_cf: "BtoC" },
    { codice_cliente: "4", cod_alternativo: "DIRECT", nome_ricerca_cf: null },
  ]);
  assert.deepEqual(summary.expected, { contoTerzi: 1, b2b: 1, online: 1, unclassified: 1 });
  assert.deepEqual(summary.suspiciousValues, [{ value: "DIRECT / VUOTO", customers: 1, reason: "combinazione Mexal non classificabile" }]);
});

test("la migrazione azzera il vecchio metodo e ricostruisce solo clienti attivi", () => {
  assert.match(migration, /delete from public\.crm_customer_classifications/);
  assert.match(migration, /crm_customer_area_from_mexal_fields/);
  assert.match(migration, /customer\.attivo_mexal is true/);
  assert.match(migration, /origine_classificazione = 'mexal_fields'/);
  assert.match(migration, /'crm_direct','CRM DIRECT'/);
  assert.doesNotMatch(migration, /crm_customer_area_from_agent/);
});

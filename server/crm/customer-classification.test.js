import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyCustomerAgent, summarizeCustomers } from "../../scripts/simulate-crm-customer-classification.mjs";

const migration = readFileSync(new URL("../../supabase/migrations/20260825100000_crm_customer_classification.sql", import.meta.url), "utf8");

test("classifica gli agenti con trim e confronto case-insensitive", () => {
  assert.equal(classifyCustomerAgent(null), "conto_terzi");
  assert.equal(classifyCustomerAgent("   "), "conto_terzi");
  assert.equal(classifyCustomerAgent(" maria   ripa "), "conto_terzi");
  assert.equal(classifyCustomerAgent("amazon"), "online");
  assert.equal(classifyCustomerAgent(" Online "), "online");
  assert.equal(classifyCustomerAgent("Qualsiasi altro agente"), "b2b");
});

test("la simulazione copre ogni cliente una sola volta e segnala codici irrisolti", () => {
  const summary = summarizeCustomers([
    { codice_cliente: "1", codice_agente_mexal: null },
    { codice_cliente: "2", codice_agente_mexal: "MR" },
    { codice_cliente: "3", codice_agente_mexal: "AMZ" },
    { codice_cliente: "4", codice_agente_mexal: "ONL" },
    { codice_cliente: "5", codice_agente_mexal: "X" },
  ], [
    { codice: "MR", nome: "Maria", cognome: "Ripa" },
    { codice: "AMZ", nome: "Amazon", cognome: "" },
    { codice: "ONL", nome: "Online", cognome: "" },
  ]);
  assert.deepEqual(summary.expected, { contoTerzi: 2, b2b: 1, online: 2, unclassified: 0 });
  assert.deepEqual(summary.suspiciousValues, [{ value: "X", customers: 1, reason: "codice agente non risolto in mexal_agenti" }]);
});

test("la migrazione conserva un solo riferimento al cliente canonico e protegge gli override", () => {
  assert.match(migration, /codice_cliente text primary key\s+references public\.ordini_clienti_cache/);
  assert.match(migration, /area_crm text generated always as \(coalesce\(area_override, area_automatica\)\) stored/);
  assert.match(migration, /on conflict \(codice_cliente\) do update/);
  assert.match(migration, /workspace_user_is_admin\(\)/);
  assert.match(migration, /crm_customer_classifications\.area_automatica is distinct from excluded\.area_automatica/);
  assert.doesNotMatch(migration, /ragione_sociale\s+text/);
});

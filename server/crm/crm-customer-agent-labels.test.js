import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260912234500_restore_crm_customer_agent_labels.sql", import.meta.url),
  "utf8",
);
const css = readFileSync(new URL("../../src/modules/crm/workspace-alignment.css", import.meta.url), "utf8");

test("il responsabile CRM deriva dall'agente del cliente Mexal senza cambiare l'area", () => {
  assert.match(migration, /crm_customer_effective_area\(customer\.cod_alternativo, customer\.nome_ricerca_cf, customer\.crm_restored_area\)/);
  assert.match(migration, /crm_customer_agent_label\(customer\.codice_agente_mexal\)/);
  assert.match(migration, /agente_classificazione = excluded\.agente_classificazione/);
  assert.match(migration, /update of cod_alternativo, nome_ricerca_cf, attivo_mexal, codice_agente_mexal/);
  assert.match(migration, /then 'reactivation_history' else 'mexal_fields' end/);
  assert.match(migration, /create or replace function public\.crm_refresh_customer_classifications\(\)/);
  assert.doesNotMatch(migration, /\b(insert|update|delete)\s+(?:into\s+)?public\.(?:ruoli|ruoli_moduli|workspace_moduli|workspace_schermate)\b/i);
});

test("la tabella clienti CRM compatta tutte le colonne nella larghezza desktop", () => {
  assert.match(css, /\.crm-customer-table\{width:100%;min-width:0;table-layout:fixed\}/);
  assert.match(css, /\.crm-customer-table th,.crm-customer-table td\{padding:10px 8px/);
  assert.match(css, /\.crm-customer-table \.workspace-table-column-controls\{[^}]*min-width:0/);
});

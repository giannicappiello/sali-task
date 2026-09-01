import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260830220000_crm_oct_economics_refresh_country.sql", import.meta.url),
  "utf8",
);
const dashboardMigration = readFileSync(
  new URL("../../supabase/migrations/20260830210000_crm_overview_requested_adjustments.sql", import.meta.url),
  "utf8",
);
const octSync = readFileSync(new URL("../mexal/sync-oct-orders.js", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../../src/modules/crm/CommercialControlDashboard.jsx", import.meta.url), "utf8");
const automation = readFileSync(new URL("../../api/mexal/automation.js", import.meta.url), "utf8");

test("gli OCT importati conservano economia di riga e totali di testata", () => {
  for (const field of ["prezzo_listino", "sconto_commerciale", "prezzo_netto", "imponibile_riga", "totale_riga", "totale_imponibile", "totale_documento"]) {
    assert.match(octSync, new RegExp(field));
  }
  assert.match(octSync, /calculateOrderLineEconomics/);
});

test("la sorgente KPI conta ogni testata una volta e conserva il lineage Mexal", () => {
  assert.match(migration, /create or replace view public\.crm_order_kpi_source/);
  assert.match(migration, /document\.tipo_documento in \('OCT', 'OCM', 'OCI', 'OCX'\)/);
  assert.match(migration, /when order_header\.origine = 'mexal_oct' then 'mexal_oct'/);
  assert.match(dashboardMigration, /public\.crm_order_kpi_source customer_order/);
  assert.doesNotMatch(migration, /pg_get_functiondef|execute definition/);
});

test("il refresh usa argomenti primitivi stabili e annulla richieste superate", () => {
  assert.match(dashboard, /JSON\.stringify\(requestArguments\)/);
  assert.match(dashboard, /new AbortController\(\)/);
  assert.match(dashboard, /sequence !== requestSequence\.current/);
  assert.doesNotMatch(dashboard, /setInterval|setTimeout|lastAutomaticRequest|visibilitychange/);
});

test("Paese viene normalizzato e sottoposto a backfill senza inventare valori", () => {
  assert.match(migration, /create or replace function public\.crm_country_json_scalar/);
  assert.match(migration, /create or replace function public\.crm_normalize_country_code/);
  assert.match(migration, /update public\.ordini_clienti_cache customer/);
  assert.match(migration, /crm_normalize_country_code\(customer\.paese/);
  assert.match(migration, /raw_country in \('IT', 'ITA', 'ITALIA', 'ITALY', '380'\)/);
});

test("il ciclo OCT segue l'abilitazione del ciclo Ordini per il backfill", () => {
  assert.match(migration, /oct_schedule\.sync_type = 'oct_orders'/);
  assert.match(migration, /orders_schedule\.sync_type = 'orders'/);
  assert.match(migration, /set enabled = orders_schedule\.enabled/);
  assert.match(automation, /const SYNC_ALL_PHASES[\s\S]*"sales_invoices",[\s\S]*"oct_orders"/);
});

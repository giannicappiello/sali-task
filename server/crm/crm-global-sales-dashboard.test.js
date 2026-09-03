import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const panel = read("src/modules/crm/CustomerClassificationPanel.jsx");
const dashboard = read("src/modules/crm/CommercialControlDashboard.jsx");
const crm = read("src/modules/crm/CrmModule.jsx");
const css = read("src/modules/crm/customer-classification.css");
const dashboardCss = read("src/modules/crm/commercial-control-dashboard.css");
const migration = read("supabase/migrations/20260830153000_crm_global_sales_distribution.sql");
const controlMigration = read("supabase/migrations/20260830170000_crm_commercial_control_dashboards.sql");

test("le dashboard si aggiornano su filtri o comando manuale senza polling", () => {
  assert.doesNotMatch(`${panel}${dashboard}`, /setInterval|AUTO_REFRESH_MS|visibilitychange/);
  assert.match(dashboard, /CrmPeriodFilter period=\{period\}/);
  assert.match(dashboard, /Nessun polling automatico/);
  assert.match(dashboard, /onClick=\{\(\) => void load\(\)\}/);
  assert.match(dashboard, /crm_commercial_control_dashboard/);
});

test("KPI e grafici distinguono fatturato, ordinato, ordini e pezzi", () => {
  for (const label of ["Fatturato", "Ordinato", "Numero ordini", "Pezzi fatturati", "Pezzi ordinati", "Distribuzione per categoria", "Distribuzione per sottocategoria"]) {
    assert.match(panel, new RegExp(label));
  }
  assert.match(panel, /Fatturato Mexal/);
  assert.match(panel, /Ordinato Workspace/);
  assert.match(css, /crm-sales-paired-bars/);
  assert.match(css, /@media\(max-width:640px\)/);
});

test("Globale, PRIVATE e DIRECT sono dashboard distinte con filtri persistenti", () => {
  assert.match(crm, /CommercialControlDashboard scope="global" embedded/);
  assert.match(crm, /case "dashboard": return route\.type === "conto_terzi" \? <CrmPrivateDashboard \/> : <CrmDashboard type=\{route\.type\} \/>/);
  assert.match(crm, /crm_dashboard_metrics/);
  assert.match(crm, /CommercialControlDashboard scope="direct" embedded/);
  for (const field of ["business", "market", "country", "agent", "channel", "customer", "granularity", "compare"]) assert.match(dashboard, new RegExp(`setFilter\\("${field}"`));
  assert.match(dashboard, /useSearchParams/);
  assert.match(dashboardCss, /@media\(max-width:1180px\)/);
  assert.match(dashboardCss, /@media\(max-width:820px\)/);
  assert.match(dashboardCss, /@media\(max-width:560px\)/);
});

test("la RPC usa solo dimensioni reali e segnala i gap Field Force e Online", () => {
  for (const field of ["cod_alternativo", "nome_ricerca_cf", "cod_paese", "codice_agente_mexal", "attivo_mexal", "crm_active", "stato_operativo"]) assert.match(controlMigration, new RegExp(field));
  assert.match(controlMigration, /field_force/);
  assert.match(controlMigration, /non esiste un mapping affidabile/);
  assert.match(controlMigration, /Online coincide oggi con DIRECT\/BtoC/);
  assert.match(controlMigration, /crm_customer_classification_visible/);
});

test("riordini e clienti persi dipendono dalla frequenza storica individuale", () => {
  assert.match(controlMigration, /avg\(gap_days\)/);
  assert.match(controlMigration, /partition by codice_cliente/);
  assert.match(controlMigration, /average_gap_days \* 0\.85/);
  assert.match(controlMigration, /average_gap_days \* 1\.15/);
  assert.match(controlMigration, /average_gap_days \* 2\.50/);
  assert.match(dashboard, /Frequenza storica individuale/);
});

test("gli elenchi CRM mostrano importi netti e nascondono le colonne tecniche", () => {
  assert.doesNotMatch(panel, /<th>Cod\. alternativo<\/th>/);
  assert.doesNotMatch(panel, /<th>Nome ricerca<\/th>/);
  assert.doesNotMatch(panel, /<th>Ultima classificazione<\/th>/);
  assert.match(panel, /<th>Fatturato netto<\/th>/);
  assert.match(panel, /<th>Ordinato netto<\/th>/);
  assert.match(crm, /<th>Fatturato netto<\/th>/);
  assert.match(crm, /<th>Ordinato netto<\/th>/);
});

test("l'aggregazione server-side usa righe nette e categorie prodotto reali", () => {
  assert.match(migration, /crm_global_sales_distribution/);
  assert.match(migration, /line\.valore_netto/);
  assert.match(migration, /line\.totale_riga/);
  assert.match(migration, /product\.categoria_mexal/);
  assert.match(migration, /product\.sottocategoria_mexal/);
  assert.match(migration, /invoice_pieces/);
  assert.match(migration, /order_pieces/);
  assert.match(migration, /create or replace function public\.crm_customer_metric_details/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const dashboard = read("src/modules/crm/CommercialControlDashboard.jsx");
const css = read("src/modules/crm/commercial-control-dashboard.css");
const syncClients = read("server/mexal/sync-clients.js");
const migration = read("supabase/migrations/20260830210000_crm_overview_requested_adjustments.sql");

test("la CRM Overview non ripete richieste automatiche identiche", () => {
  assert.match(dashboard, /lastAutomaticRequest/);
  assert.match(dashboard, /lastAutomaticRequest\.current === automaticRequestKey/);
  assert.doesNotMatch(dashboard, /setInterval|visibilitychange/);
});

test("l'avviso tecnico sulle dimensioni non esposte non viene renderizzato", () => {
  assert.doesNotMatch(dashboard, /Dimensioni non esposte senza mapping affidabile|crm-control-gaps|TrendingUp/);
});

test("le KPI card sono pulsanti attivi e portano alla sezione di dettaglio", () => {
  assert.match(dashboard, /<button className="crm-control-kpi"/);
  assert.match(dashboard, /scrollIntoView/);
  assert.match(dashboard, /onActivate=\{\(\) => activateCard\(target\)\}/);
});

test("font e resoconti PRIVATE DIRECT sono più compatti con dettaglio DIRECT", () => {
  assert.match(css, /crm-control-kpi strong\{font-size:clamp\(18px,1\.7vw,25px\)/);
  assert.match(css, /crm-business-summary\{grid-template-columns:repeat\(2,minmax\(0,280px\)\)/);
  for (const field of ["btob_invoice_total", "btoc_invoice_total", "foreign_invoice_total"]) assert.match(`${dashboard}${migration}`, new RegExp(field));
});

test("andamento visualizza la composizione del fatturato PRIVATE DIRECT", () => {
  assert.match(dashboard, /Composizione fatturato PRIVATE \/ DIRECT/);
  assert.match(dashboard, /private_invoice_total/);
  assert.match(dashboard, /direct_invoice_total/);
  assert.doesNotMatch(dashboard, /aria-label="Andamento fatturato e ordinato"/);
});

test("Paese è normalizzato dalle varianti Mexal e mantenuto nei futuri sync", () => {
  for (const key of ["cod_paese", "codice_paese", "paese", "cod_nazione", "nazione"]) assert.match(syncClients, new RegExp(`"${key}"`));
  assert.match(migration, /add column if not exists paese text/);
  assert.match(migration, /nullif\(btrim\(customer\.paese\)/);
  assert.match(syncClients, /\["IT", "ITA", "ITALIA", "ITALY", "380"\]/);
});

test("i KPI ordine usano la sorgente canonica che include gli OCT", () => {
  assert.match(migration, /crm_order_kpi_source customer_order/);
  assert.match(dashboard, /inclusi OCT/);
});

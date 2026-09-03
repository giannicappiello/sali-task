import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260825110000_crm_operational_analytics.sql");
const crm = read("src/modules/crm/CrmModule.jsx");
const opportunity = read("src/modules/crm/CrmOpportunityDetail.jsx");
const period = read("src/modules/crm/CrmPeriodFilter.jsx");
const digital = read("src/modules/crm/DigitalCommerce.jsx");
const ai = read("src/modules/crm/CrmAIBrief.jsx");
const aiServer = read("server/ai/crm-brief.js");
const css = read("src/modules/crm/crm.css");

test("analytics CRM aggrega server-side e mantiene distinte le sorgenti economiche", () => {
  assert.match(migration, /crm_dashboard_metrics/);
  assert.match(migration, /crm_customer_metric_details/);
  assert.match(migration, /crm_customer_period_metrics/);
  assert.match(migration, /mexal_fatture_vendita/);
  assert.match(migration, /ordini_testate/);
  assert.match(migration, /order_source_note/);
  assert.match(migration, /invoice_source_note/);
  assert.match(migration, /crm_customer_classification_visible/);
  assert.doesNotMatch(migration, /grant select on public\.ordini_clienti_cache to authenticated/);
});

test("periodo CRM è condiviso, personalizzabile e persistito nella query string", () => {
  for (const preset of ["today", "week", "month", "previous_month", "30", "90", "year", "previous_year", "custom"]) {
    assert.match(period, new RegExp(`value="${preset}"|case "${preset}"`));
  }
  assert.match(period, /params\.set\("from"/);
  assert.match(period, /params\.set\("to"/);
  assert.match(crm, /useCrmPeriod/);
  assert.match(digital, /useCrmPeriod/);
  assert.match(ai, /useCrmPeriod/);
  assert.match(aiServer, /requestPeriod\(body\)/);
  assert.match(aiServer, /crm_dashboard_metrics/);
});

test("KPI aprono drill-down reali e la lista pagina il dataset completo filtrabile", () => {
  assert.match(crm, /aria-label=.*Apri dettaglio/);
  assert.match(crm, /crm_customer_metric_details/);
  assert.match(crm, /metric: "invoiced"/);
  assert.match(crm, /metric: "ordered"/);
  assert.match(crm, /metric: "inactive"/);
  assert.match(crm, /loadAllRpcRows\("crm_customer_metric_details"/);
  assert.match(crm, /usePaginatedDataset\(rows, ACCOUNT_COLUMNS, tableQuery, page, CRM_CUSTOMER_PAGE_SIZE\)/);
});

test("scheda cliente espone lifetime e periodo senza aggregare migliaia di righe nel browser", () => {
  assert.match(crm, /crm_customer_period_metrics/);
  assert.match(crm, /Fatturato lifetime/);
  assert.match(crm, /Ordinato lifetime/);
  assert.match(crm, /gte\("data_ordine", period\.from\)/);
  assert.match(crm, /gte\("data_documento", period\.from\)/);
});

test("pipeline supporta kanban, lista, valore ponderato, scadenze e storico fase", () => {
  assert.match(migration, /crm_opportunity_stage_history/);
  assert.match(migration, /crm_record_opportunity_stage_change/);
  assert.match(crm, /updatePipelineParam\("view", "kanban"\)/);
  assert.match(crm, /updatePipelineParam\("view", "list"\)/);
  assert.match(crm, /Valore ponderato/);
  assert.match(`${crm}${opportunity}`, /Giorni nello stato|Tempo nella fase/);
  assert.match(crm, /Chiusura prevista/);
  assert.match(crm, /Prossima attività/);
});

test("layout operativo copre i breakpoint richiesti", () => {
  for (const breakpoint of [1024, 768, 480]) assert.match(css, new RegExp(`@media\\(max-width:${breakpoint}px\\)`));
  assert.match(css, /\.crm-period-filter/);
  assert.match(css, /\.crm-toolbar-actions/);
  assert.match(css, /\.crm-opportunity-detail/);
});

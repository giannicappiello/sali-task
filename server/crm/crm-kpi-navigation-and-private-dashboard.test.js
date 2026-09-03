import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("CRM DIRECT usa una sola testata e card canale interamente cliccabili", () => {
  const crm = read("src/modules/crm/CrmModule.jsx");
  const direct = crm.slice(crm.indexOf("function CrmDirectOverview"), crm.indexOf("function CrmPrivateDashboard"));
  assert.doesNotMatch(direct, /ModuleContainerLayout/);
  assert.match(direct, /className="panel crm-direct-area-card"/);
  assert.match(direct, /<CommercialControlDashboard scope="direct" embedded \/>/);
});

test("la dashboard PRIVATE ripristina la cabina commerciale senza seconda testata", () => {
  const crm = read("src/modules/crm/CrmModule.jsx");
  const privateDashboard = crm.slice(crm.indexOf("function CrmPrivateDashboard"), crm.indexOf("const CRM_KPI_INFO"));
  assert.match(privateDashboard, /CommercialControlDashboard scope="private" embedded/);
  assert.match(privateDashboard, /Navigazione CRM PRIVATE/);
  assert.doesNotMatch(privateDashboard, /ModuleContainerLayout/);
});

test("KPI analisi e ciclo B2B aprono drill-down che applicano i filtri", () => {
  const analytics = read("src/modules/crm/CrmAnalyticsPage.jsx");
  const beauty = read("src/modules/crm/CrmBeautyDays.jsx");
  const workflows = read("src/modules/crm/CrmWorkflowPages.jsx");
  const crm = read("src/modules/crm/CrmModule.jsx");
  assert.match(analytics, /<Link className="kpi-card crm-kpi"/);
  assert.match(analytics, /outcome: "won"/);
  assert.match(analytics, /outcome: "lost"/);
  assert.match(crm, /matchesOutcome/);
  assert.match(beauty, /<Link className="kpi-card crm-kpi"/);
  assert.match(beauty, /segment: "prospect"|worklist\("prospect"\)/);
  assert.match(workflows, /row\.classificazione === segment/);
});

test("catalogo rinomina la schermata in Dashboard PRIVATE", () => {
  const migration = read("supabase/migrations/20260903220000_rename_private_dashboard.sql");
  assert.match(migration, /nome = 'Dashboard PRIVATE'/);
  assert.match(migration, /where codice = 'crm\.conto_terzi\.dashboard'/);
});

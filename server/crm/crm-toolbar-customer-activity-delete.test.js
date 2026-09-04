import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const ui = read("src/modules/crm/CrmWorkspaceUI.jsx");
const crm = read("src/modules/crm/CrmModule.jsx");
const dashboard = read("src/modules/crm/CommercialControlDashboard.jsx");
const activities = read("src/modules/crm/CrmActivitiesPage.jsx");
const workflows = read("src/modules/crm/CrmWorkflowPages.jsx");
const opportunity = read("src/modules/crm/CrmOpportunityDetail.jsx");
const css = read("src/modules/crm/workspace-alignment.css");
const migration = read("supabase/migrations/20260904120000_crm_customer_toolbar_activity_delete.sql");

test("la navigazione evidenzia soltanto la route CRM più specifica", () => {
  assert.match(ui, /sort\(\(left, right\) => right\.length - left\.length\)/);
  assert.match(ui, /const active = path === activePath/);
  assert.match(ui, /aria-current=\{active \? "page"/);
});

test("le toolbar CRM riusano la composizione dashboard a pannelli separati", () => {
  assert.match(ui, /className="crm-page-navigation"/);
  assert.match(css, /\.workspace-screen-content \.crm-page-navigation/);
  assert.match(css, /\.workspace-screen-content \.crm-page-header-row/);
  assert.match(css, /order:1/);
  assert.match(css, /order:2/);
});

test("la tabella top clienti lascia la dashboard e diventa la tabella completa Clienti", () => {
  assert.doesNotMatch(dashboard, /Top clienti PRIVATE/);
  for (const column of ["Fatturato", "Ordinato", "Ultimo ordine", "Frequenza", "Riordino previsto", "Responsabile", "Stato CRM", "Stato Mexal"]) {
    assert.match(crm, new RegExp(column));
  }
  assert.match(crm, /crm_customer_cadence_details/);
  assert.match(crm, /crm-control-table/);
  assert.match(migration, /purchase\.purchase_date - lag\(purchase\.purchase_date\)/);
});

test("qualsiasi elenco attività consente eliminazione solo in scrittura", () => {
  assert.match(activities, /CrmDeleteActivityButton/);
  assert.match(workflows, /CrmDeleteActivityButton/);
  assert.match(opportunity, /CrmDeleteActivityButton/);
  assert.match(crm, /CrmDeleteActivityButton/);
  for (const source of [activities, workflows, opportunity, crm]) assert.match(source, /canWrite/);
});

test("l'eliminazione attività è atomica, autorizzata e auditata senza cancellare lavoro Workspace", () => {
  assert.match(migration, /create or replace function public\.crm_delete_activity/);
  assert.match(migration, /crm_has_module_level\([^;]*'scrittura'/s);
  assert.match(migration, /crm_row_visible/);
  assert.match(migration, /delete from public\.crm_workspace_links/);
  assert.match(migration, /update public\.v4_fasi_progetto\s+set crm_activity_id = null/);
  assert.match(migration, /update public\.v4_progetti\s+set crm_activity_id = null/);
  assert.match(migration, /'attivita_eliminata'/);
  assert.match(migration, /delete from public\.crm_activities/);
  assert.doesNotMatch(migration, /delete from public\.v4_(progetti|fasi_progetto)/);
});

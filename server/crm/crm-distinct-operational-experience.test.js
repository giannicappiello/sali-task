import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { crmNavigation } from "../../src/modules/crm/crmNavigation.js";
import { CRM_ROUTE_CATALOG } from "../../src/modules/crm/crmRouteCatalog.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260903170000_crm_distinct_operational_experience.sql");
const screenCatalogMigration = read("supabase/migrations/20260903180000_crm_distinct_screen_catalog.sql");
const pages = read("src/modules/crm/CrmWorkflowPages.jsx");
const opportunity = read("src/modules/crm/CrmOpportunityDetail.jsx");
const crmModule = read("src/modules/crm/CrmModule.jsx");

test("PRIVATE e B2B espongono menu e route realmente distinti", () => {
  const privateLabels = crmNavigation("conto_terzi").map(([label]) => label);
  const b2bLabels = crmNavigation("b2b").map(([label]) => label);
  assert.deepEqual(privateLabels, ["Dashboard", "Clienti", "Opportunità", "Pipeline", "Attività", "Campioni / Sviluppi", "Progetti", "Analisi"]);
  assert.deepEqual(b2bLabels, ["Dashboard", "Clienti / Prospect", "Pipeline acquisizione", "Attività", "Clienti da seguire", "Riordini", "BeautyDays", "Analisi"]);
  for (const view of ["opportunities", "developments", "projects"]) assert.ok(CRM_ROUTE_CATALOG.some((route) => route.type === "conto_terzi" && route.view === view));
  for (const view of ["follow-up", "reorders", "beautydays"]) assert.ok(CRM_ROUTE_CATALOG.some((route) => route.type === "b2b" && route.view === view));
});

test("ogni route CRM usa una chiave React univoca", () => {
  const catalogPaths = CRM_ROUTE_CATALOG.map((route) => route.catalogPath);
  assert.equal(new Set(catalogPaths).size, catalogPaths.length);
  assert.match(crmModule, /<Route key=\{route\.catalogPath\}/);
  assert.doesNotMatch(crmModule, /<Route key=\{route\.screenCode\}/);
});

test("le esperienze operative hanno schermate Workspace dedicate", () => {
  for (const screenCode of [
    "crm.conto_terzi.opportunita", "crm.conto_terzi.attivita", "crm.conto_terzi.sviluppi",
    "crm.conto_terzi.progetti", "crm.conto_terzi.analisi", "crm.b2b.attivita",
    "crm.b2b.da_seguire", "crm.b2b.riordini", "crm.b2b.beautydays", "crm.b2b.analisi",
  ]) {
    assert.ok(CRM_ROUTE_CATALOG.some((route) => route.screenCode === screenCode));
    assert.match(screenCatalogMigration, new RegExp(screenCode.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(screenCatalogMigration, /\b(update|delete|truncate)\b\s+public\.(crm_|v4_)/i);
});

test("dashboard PRIVATE rappresenta il ciclo prodotto-progetto", () => {
  for (const label of ["Pipeline ponderata", "Senza prossima attività", "Preventivi in attesa", "Campioni in attesa", "Opportunità ferme", "Chiusure previste", "Progetti collegati"]) assert.match(pages, new RegExp(label));
  assert.match(pages, /Prospect[\s\S]*Opportunità[\s\S]*Brief[\s\S]*Valutazione tecnica[\s\S]*Campionatura[\s\S]*Offerta[\s\S]*Progetto Workspace/);
});

test("scheda opportunità PRIVATE crea un brief tecnico sul core esistente", () => {
  for (const field of ["categoria", "tipo_prodotto", "quantita", "packaging", "prezzo_target", "mercati", "certificazioni", "formula", "claim", "note"]) assert.match(opportunity, new RegExp(field));
  assert.match(opportunity, /opportunity_id: opportunityId/);
  assert.match(opportunity, /account_id: opportunity\.account_id/);
  assert.match(opportunity, /Crea brief tecnico/);
});

test("worklist B2B è server-side, usa ordini canonici ed è non distruttiva", () => {
  assert.match(migration, /create or replace function public\.crm_b2b_customer_worklist/);
  assert.match(migration, /from public\.crm_order_kpi_source/);
  for (const classification of ["prospect", "primo_ordine", "attivo", "a_rischio", "dormiente", "perso"]) assert.match(migration, new RegExp(`'${classification}'`));
  assert.match(migration, /crm_b2b_first_order_suggestions/);
  assert.match(migration, /op\.ordine_collegato_id is null/);
  assert.match(migration, /chiusura resta una conferma utente/);
  assert.doesNotMatch(migration, /\b(update|delete|truncate)\b\s+public\./i);
});

test("liste operative mantengono link cliente canonico e query string", () => {
  assert.match(pages, /CrmCustomerLink/);
  assert.match(pages, /useSearchParams/);
  assert.match(pages, /customerSearch/);
  assert.match(pages, /crm_b2b_customer_worklist/);
  assert.match(pages, /CrmBeautyDashboardPanel/);
});

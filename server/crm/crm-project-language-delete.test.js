import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const crm = read("src/modules/crm/CrmModule.jsx");
const detail = read("src/modules/crm/CrmOpportunityDetail.jsx");
const navigation = read("src/modules/crm/crmNavigation.js");
const css = read("src/modules/crm/workspace-alignment.css");
const migration = read("supabase/migrations/20260904150000_crm_project_delete.sql");

test("la UI usa un solo archivio Progetti condiviso con Workspace", () => {
  assert.match(navigation, /\["Progetti", `\$\{basePath\}\/progetti`\]/);
  assert.doesNotMatch(navigation, /Progetti Workspace/);
  assert.match(crm, /Titolo progetto/);
  assert.match(crm, /Crea opportunità/);
});

test("la creazione usa una ricerca rapida cliente accessibile", () => {
  assert.match(crm, /placeholder="Ricerca rapida cliente o codice"/);
  assert.match(crm, /role="combobox"/);
  assert.match(crm, /role="listbox"/);
  assert.match(crm, /selectCustomer/);
  assert.match(css, /crm-customer-quick-search/);
  assert.match(css, /crm-quick-search-results/);
});

test("progetti e attività espongono eliminazione controllata", () => {
  assert.match(crm, /CrmDeleteProjectButton project=\{item\}/);
  assert.match(detail, /CrmDeleteProjectButton project=\{opportunity\}/);
  assert.match(detail, /CrmDeleteActivityButton activity=\{item\}/);
  assert.match(migration, /create or replace function public\.crm_delete_opportunity/);
  assert.match(migration, /crm_has_module_level[\s\S]*'scrittura'/);
  assert.match(migration, /crm_row_visible/);
  assert.match(migration, /'progetto_eliminato'/);
  assert.match(migration, /delete from public\.crm_opportunities/);
  assert.match(migration, /workspace_projects_preserved/);
  assert.match(migration, /revoke all on function public\.crm_delete_opportunity\(uuid\) from public, anon/);
});

test("il catalogo Workspace viene riallineato al linguaggio Progetti", () => {
  assert.match(migration, /nome = 'Progetti PRIVATE'/);
  assert.match(migration, /Clienti, brief e progetti commerciali conto terzi/);
});

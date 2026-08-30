import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const layout = read("src/components/WorkspaceScreenLayout.jsx");
const app = read("src/App.jsx");
const crm = read("src/modules/crm/CrmModule.jsx");
const css = read("src/modules/crm/crm.css");
const migration = read("supabase/migrations/20260830190000_crm_direct_documents_and_private_activities.sql");

test("un modulo contenitore con schermata esatta non riceve una seconda testata", () => {
  assert.match(layout, /exactModule\?\.tipo === "contenitore"/);
  assert.doesNotMatch(layout, /exactModule\?\.tipo === "contenitore" && !exactScreen/);
});

test("Documenti Direct è protetto dalla route e assegnabile ai reparti", () => {
  assert.match(app, /path="documentation" element=\{<WorkspaceAccessGuard moduleCode="documenti">/);
  assert.match(migration, /nome = 'Documenti Direct'/);
  assert.match(migration, /sempre_disponibile = false/);
  assert.match(migration, /assegnabile_reparto = true/);
  assert.match(migration, /workspace_module_enabled_for_user\(current_user_profile\.id, 'documenti'\)/);
});

test("le attività PRIVATE inizializzano soltanto l'estensione CRM canonica", () => {
  assert.match(crm, /crm_ensure_canonical_account/);
  for (const activity of ["campionatura", "sviluppo_formula", "preventivo"]) assert.match(crm, new RegExp(activity));
  assert.match(migration, /on conflict \(tipo, codice_cliente_mexal\)/);
  assert.match(migration, /ensure_canonical_extension/);
});

test("le card cliente sono compatte, interamente espandibili e accessibili da tastiera", () => {
  assert.match(crm, /function CrmExpandableCard/);
  assert.match(crm, /<details id=\{id\}/);
  assert.match(crm, /<summary>/);
  assert.match(css, /-webkit-line-clamp:2/);
  assert.match(css, /crm-expandable-card>summary:focus-visible/);
});

test("la sorgente KPI include OCT OCM OCI OCX senza duplicare le testate", () => {
  assert.match(migration, /create or replace view public\.crm_order_kpi_source/);
  for (const documentType of ["OCT", "OCM", "OCI", "OCX"]) assert.match(migration, new RegExp(`'${documentType}'`));
  assert.match(migration, /order_header\.origine = 'mexal_oct'/);
  assert.match(migration, /array_agg\(distinct document\.tipo_documento/);
  assert.match(crm, /ordini Workspace\/Mexal/);
});

/* global process */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { resolveCatalogModuleDestination } from "../../src/config/workspaceNavigation.js";
import { CRM_ROUTE_CATALOG, selectAuthorizedCrmModules } from "../../src/modules/crm/crmRouteCatalog.js";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

test("la route principale CRM apre la panoramica protetta dal catalogo", () => {
  const app = read("src/App.jsx");
  const crm = read("src/modules/crm/CrmModule.jsx");
  const guard = read("src/components/WorkspaceAccessGuard.jsx");

  assert.match(app, /<Route path="crm\/\*" element={<CrmModule \/>} \/>/);
  assert.ok(CRM_ROUTE_CATALOG.some((route) => route.index && route.catalogPath === "/crm" && route.screenCode === "crm.dashboard"));
  assert.match(crm, /CRM_ROUTE_CATALOG\.map/);
  assert.match(guard, /hasModuleAccess\(moduleCode\)/);
  assert.match(guard, /workspace_moduli_schermate/);
  assert.match(guard, /catalogState !== "available"/);
});

test("la panoramica deriva aree e destinazioni dal catalogo", () => {
  const crm = read("src/modules/crm/CrmModule.jsx");

  assert.match(crm, /select\("codice,nome,descrizione,icona,dipendenze_alternative"\)/);
  assert.match(crm, /select\("codice,nome,descrizione,percorso,icona,attivo"\)/);
  assert.match(crm, /selectAuthorizedCrmModules\(dependencies, modules, hasModuleAccess\)/);
  assert.match(crm, /to: module\.percorso/);
});

test("il catalogo canonico collega CRM a /crm e include il contenitore DIRECT", () => {
  const migration = read("supabase/migrations/20260824131000_fix_crm_container_navigation.sql");
  const hierarchyMigration = read("supabase/migrations/20260830120000_mexal_active_clients_crm_hierarchy.sql");

  assert.match(migration, /percorso = '\/crm'/);
  assert.match(migration, /dipendenze_alternative = array\['crm_conto_terzi','crm_b2b','crm_online','crm_ai'\]/);
  assert.match(migration, /where voce_codice = 'crm' and modulo_codice <> 'crm'/);
  assert.match(migration, /values \('crm','crm',10\)/);
  assert.match(migration, /where codice = 'crm\.dashboard'/);
  assert.match(migration, /values \('crm','crm\.dashboard',10,true,true\)/);

  const matrix = migration.match(/with canonical_crm_routes\(codice,percorso\) as \(values([\s\S]*?)\)\s*update public\.workspace_schermate/);
  assert.ok(matrix, "matrice route SQL non trovata");
  const catalogRoutes = [...matrix[1].matchAll(/\('([^']+)','([^']+)'\)/g)]
    .map((match) => ({ screenCode: match[1], catalogPath: match[2] }))
    .concat([{ screenCode: "crm.direct.dashboard", catalogPath: "/crm/direct" }])
    .toSorted((left, right) => left.screenCode.localeCompare(right.screenCode));
  const reactRoutes = CRM_ROUTE_CATALOG
    .filter((route) => !["opportunity", "activities", "analytics"].includes(route.view))
    .map(({ screenCode, catalogPath }) => ({ screenCode, catalogPath }))
    .toSorted((left, right) => left.screenCode.localeCompare(right.screenCode));
  assert.deepEqual(reactRoutes, catalogRoutes);
  assert.match(hierarchyMigration, /dipendenze_alternative=array\['crm_conto_terzi','crm_direct','crm_ai'\]/);
});

test("il menu risolve il catalogo senza fallback a Home", () => {
  const layout = read("src/components/Layout.jsx");
  const screens = [{ codice: "crm.dashboard", percorso: "/crm" }];
  const links = [{ modulo_codice: "crm", schermata_codice: "crm.dashboard", ordine: 10, predefinita: true, visibile_menu: true }];

  assert.equal(resolveCatalogModuleDestination({ codice: "crm", percorso: "/crm" }, null, screens, links), "/crm");
  assert.equal(resolveCatalogModuleDestination({ codice: "crm", percorso: null }, null, screens, links), "/crm");
  assert.equal(resolveCatalogModuleDestination({ codice: "crm", percorso: null }, null, [], []), "");
  assert.match(layout, /item\.module && !hasModuleAccess\(item\.module\)/);
  assert.match(layout, /members\.length === 1/);
});

test("la panoramica mostra esattamente le aree CRM autorizzate", () => {
  const dependencies = ["crm_conto_terzi", "crm_b2b", "crm_online", "crm_ai"];
  const modules = dependencies.map((codice) => ({ codice, percorso: `/crm/${codice}` }));

  assert.deepEqual(selectAuthorizedCrmModules(dependencies, modules, () => true).map((module) => module.codice), dependencies);
  assert.deepEqual(selectAuthorizedCrmModules(dependencies, modules, (code) => ["crm_online", "crm_ai"].includes(code)).map((module) => module.codice), ["crm_online", "crm_ai"]);
  assert.deepEqual(selectAuthorizedCrmModules(dependencies, modules, () => false), []);
});

test("la griglia del contenitore resta responsive su mobile", () => {
  const css = read("src/components/module-container-layout.css");

  assert.match(css, /grid-template-columns:\s*repeat\(auto-fit, minmax\(270px, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /grid-template-columns:\s*1fr/);
});

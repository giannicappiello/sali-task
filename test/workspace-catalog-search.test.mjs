import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  associationSummary,
  buildWorkspaceAssociations,
  filterKeepingSelected,
  matchesAssociationStatus,
  matchesWorkspaceSearch,
} from "../src/pages/Settings/workspaceCatalog.js";

const modules = [
  { codice: "crm", nome: "CRM B2B", descrizione: "Clienti", area: "commerciale", provider: "workspace", percorso: "/crm" },
  { codice: "mag", nome: "Magazzino", descrizione: "Prodotti", area: "operations", provider: "workspace", percorso: "/magazzino" },
];
const screens = [
  { codice: "crm.clienti", nome: "Clienti", descrizione: "Anagrafiche", area: "commerciale", provider: "workspace", percorso: "/crm/clienti" },
  { codice: "orfana", nome: "Schermata orfana", area: "operations", provider: "workspace", percorso: "/orfana" },
];
const links = [{ modulo_codice: "crm", schermata_codice: "crm.clienti", predefinita: true }];
const menus = [{ codice: "vendite", nome: "Vendite", descrizione: "Area commerciale" }];
const menuModules = [{ voce_codice: "vendite", modulo_codice: "crm" }];
const areas = [{ codice: "commerciale", nome: "Commerciale" }, { codice: "operations", nome: "Operations" }];

test("ricerca Menu, Moduli e Schermate copre nome, codice, descrizione, area, origine e route", () => {
  assert.equal(matchesWorkspaceSearch(menus[0], "commerciale", ["nome", "codice", "descrizione"]), true);
  assert.equal(matchesWorkspaceSearch(modules[0], "crm b2b", ["nome", "codice", "descrizione", "area", "provider", "percorso"]), true);
  assert.equal(matchesWorkspaceSearch(modules[1], "prodotti", ["nome", "codice", "descrizione", "area", "provider", "percorso"]), true);
  assert.equal(matchesWorkspaceSearch(screens[0], "/crm/clienti", ["nome", "codice", "descrizione", "area", "provider", "percorso"]), true);
  assert.equal(matchesWorkspaceSearch(screens[0], "CLIENTI", ["nome", "codice"]), true);
});

test("ricerca icone usa etichetta e keyword e conserva la selezione durante il filtro", () => {
  const icons = [{ code: "package", label: "Prodotti", keywords: ["prodotto", "articolo"] }, { code: "bell", label: "Notifiche", keywords: [] }];
  const result = filterKeepingSelected(icons, "prodotto", ["code", "label", (item) => item.keywords.join(" ")], ["bell"], (item) => item.code);
  assert.deepEqual(result.map((item) => item.code), ["bell", "package"]);
});

test("gli elementi selezionati seguono la posizione salvata e precedono quelli non associati", () => {
  const items = [
    { codice: "overview" },
    { codice: "private" },
    { codice: "direct" },
    { codice: "brand_direct" },
    { codice: "b2b" },
  ];
  const result = filterKeepingSelected(items, "", ["codice"], ["overview", "private", "brand_direct", "direct"]);
  assert.deepEqual(result.map((item) => item.codice), ["overview", "private", "brand_direct", "direct", "b2b"]);
});

test("filtri Associati e Non associati identificano gli elementi orfani", () => {
  assert.equal(matchesAssociationStatus(1, "associated"), true);
  assert.equal(matchesAssociationStatus(0, "associated"), false);
  assert.equal(matchesAssociationStatus(0, "unassociated"), true);
});

test("associazioni reali coprono Modulo → Schermate, Schermata → Modulo e Menu → Schermata via modulo", () => {
  const graph = buildWorkspaceAssociations({ modules, screens, links, menus, menuModules, areas });
  assert.equal(graph.moduleLinks.get("crm")[0].screen.codice, "crm.clienti");
  assert.equal(graph.screenLinks.get("crm.clienti")[0].module.codice, "crm");
  const reachableScreens = graph.menuModuleLinks.get("vendite").flatMap((item) => graph.moduleLinks.get(item.modulo_codice).map((link) => link.screen.codice));
  assert.deepEqual(reachableScreens, ["crm.clienti"]);
  assert.equal(graph.screenLinks.get("orfana").length, 0);
});

test("molte associazioni mostrano le prime tre e il conteggio residuo", () => {
  assert.deepEqual(associationSummary([1, 2, 3, 4, 5]), { visible: [1, 2, 3], remaining: 2 });
});

test("UI integra click associazione, + N, warning dipendenze e persistenza filtri", async () => {
  const [controls, modulesSource, menuSource] = await Promise.all([
    readFile(new URL("../src/pages/Settings/WorkspaceCatalogControls.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Settings/ModuleManagement.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Settings/MenuManagement.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(controls, /onClick=\{\(\) => onOpen\(item\)\}/);
  assert.match(controls, /\+ \$\{items\.length - limit\} associazioni/);
  assert.match(modulesSource, /Questo elemento è utilizzato da/);
  assert.match(menuSource, /Questo elemento è utilizzato da/);
  assert.match(modulesSource, /searchParams\.get\("search"\)/);
  assert.match(modulesSource, /associationStatus/);
  assert.match(menuSource, /searchParams\.get\("search"\)/);
  assert.match(menuSource, /WorkspaceQuickSearch/);
});

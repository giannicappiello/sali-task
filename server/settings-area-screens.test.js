import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkspaceAssociations } from "../src/pages/Settings/workspaceCatalog.js";

const areas = [{ codice: "anagrafiche" }, { codice: "backoffice" }];
const modules = [{ codice: "modulo", area: "backoffice" }];
test("area includes screens even without any modules", () => {
  const screen = { codice: "prodotti", area: "anagrafiche", attiva: true };
  const result = buildWorkspaceAssociations({ areas, modules, screens: [screen] });
  assert.deepEqual(result.areaModules.get("anagrafiche"), []);
  assert.deepEqual(result.areaScreens.get("anagrafiche"), [screen]);
});
test("screen ownership overrides module membership without duplicates", () => {
  const screen = { codice: "prodotti", area: "anagrafiche" };
  const links = [{ modulo_codice: "modulo", schermata_codice: "prodotti" }, { modulo_codice: "modulo", schermata_codice: "prodotti" }];
  const result = buildWorkspaceAssociations({ areas, modules, screens: [screen], links });
  assert.deepEqual(result.areaScreens.get("anagrafiche"), [screen]);
  assert.deepEqual(result.areaScreens.get("backoffice"), []);
});
test("reassigned screens leave their previous area; inactive screens remain visible", () => {
  const result = buildWorkspaceAssociations({ areas, screens: [{ codice: "prodotti", area: "backoffice", attiva: false }] });
  assert.deepEqual(result.areaScreens.get("anagrafiche"), []);
  assert.equal(result.areaScreens.get("backoffice")[0].attiva, false);
});
test("empty areas and unassigned screens do not create inferred associations", () => {
  const result = buildWorkspaceAssociations({ areas, screens: [{ codice: "senza-area", area: null }] });
  assert.deepEqual(result.areaScreens.get("anagrafiche"), []);
  assert.equal(buildWorkspaceAssociations({}).areaScreens.size, 0);
});

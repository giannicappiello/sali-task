import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProgremesCatalog } from "../server/progremes-modules.js";
import { isProgremesScreenAuthorized, progremesModuleCodeFromMetadata } from "../server/progremes-sso.js";

test("catalog normalization keeps stable codes and declared metadata", () => {
  const now = "2026-08-21T12:00:00.000Z";
  const catalog = normalizeProgremesCatalog({
    modules: [{ code: "Documenti", name: "Documenti", route: "/documenti", group: "Documenti", active: true }],
    screens: [{ code: "Documenti", name: "Documenti", route: "/documenti", group: "Documenti", active: true }],
  }, now);
  assert.equal(catalog.modules[0].codice, "Documenti");
  assert.equal(catalog.screens[0].codice, "progremes.Documenti");
  assert.equal(catalog.screens[0].metadati.external_module_code, "Documenti");
  assert.equal(catalog.screens[0].metadati.group, "Documenti");
  assert.equal(catalog.screens[0].metadati.catalog_source, "progremes_catalog");
});

test("Workspace authorizes ProgreMES screens by their owning stable module code", () => {
  const assigned = new Set(["Formule"]);
  const nested = { external_code: "Formule.CoaProduzioni" };
  assert.equal(progremesModuleCodeFromMetadata(nested), "Formule");
  assert.equal(isProgremesScreenAuthorized(false, assigned, nested), true);
  assert.equal(isProgremesScreenAuthorized(false, new Set(), nested), false);
  assert.equal(isProgremesScreenAuthorized(true, new Set(), nested), true);
});

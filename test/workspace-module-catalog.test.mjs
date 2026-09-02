import test from "node:test";
import assert from "node:assert/strict";
import {
  DEPARTMENT_ASSIGNABLE_MODULES,
  featureIsAvailable,
  moduleLevelAllows,
  moduleSelfServiceAllows,
  moduleIsAvailable,
} from "../src/config/workspaceModules.js";

test("common workspace modules are always available", () => {
  for (const code of ["home", "attivita", "messaggi", "notifiche"]) {
    assert.equal(moduleIsAvailable(code, [], false), true, code);
  }
});

test("department modules require a grant unless the user is an administrator", () => {
  assert.equal(moduleIsAvailable("ordini_pr", [], false), false);
  assert.equal(moduleIsAvailable("ordini_pr", ["ordini_pr"], false), true);
  assert.equal(moduleIsAvailable("ordini_pr", [], true), true);
});

test("the analytics container is available through the always-visible activities module", () => {
  assert.equal(featureIsAvailable("analisi_dati", [], false), true);
  assert.equal(featureIsAvailable("analisi_fatture", ["ordini_pr"], false), false);
});

test("only explicitly assignable modules are offered to departments", () => {
  assert.deepEqual(
    DEPARTMENT_ASSIGNABLE_MODULES.map(({ code }) => code),
    ["prodotti", "magazzino", "documenti", "assistente_ai", "beauty_days", "ordini_pr", "ordini_ph", "ordini_private", "progremes", "team"]
  );
});

test("module visibility and role operativity remain separate", () => {
  assert.equal(moduleIsAvailable("prodotti", [], false), false);
  assert.equal(moduleIsAvailable("prodotti", ["prodotti"], false), true);
  assert.equal(moduleIsAvailable("magazzino", [], false), false);
  assert.equal(moduleIsAvailable("magazzino", ["magazzino"], false), true);
  assert.equal(moduleLevelAllows("lettura", "scrittura"), false);
  assert.equal(moduleLevelAllows("scrittura", "scrittura"), true);
  assert.equal(moduleLevelAllows("amministrazione", "scrittura"), true);
});

test("personal activities and messages remain operational for every user", () => {
  assert.equal(moduleSelfServiceAllows("attivita", "scrittura"), true);
  assert.equal(moduleSelfServiceAllows("messaggi", "scrittura"), true);
  assert.equal(moduleSelfServiceAllows("prodotti", "scrittura"), false);
});

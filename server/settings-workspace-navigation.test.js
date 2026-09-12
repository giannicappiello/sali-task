import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (file) => readFileSync(new URL("../src/pages/Settings/" + file, import.meta.url), "utf8");

test("all settings editors expose the same protected navigation", () => {
  const nav = read("SettingsWorkspaceNav.jsx");
  for (const label of ["Moduli", "Schermate", "Aree", "Menu", "Utenti", "Ruoli", "Verifica accessi"]) {
    assert.ok(nav.includes('label: "' + label + '"'));
  }
  assert.match(nav, /hasScreenAccess\(item.screen, "impostazioni"\)/);
  assert.match(nav, /if \(!isAdminUser\) return null/);
  assert.match(nav, /<Link key=\{id\} to=\{to\}/);
  for (const file of ["ModuleManagement", "MenuManagement", "AccessUsers", "AccessRules", "AccessCheck"]) {
    assert.match(read(file + ".jsx"), /<SettingsWorkspaceNav /);
  }
});

test("local settings tabs preserve the existing editor state and role/departments controls", () => {
  assert.match(read("ModuleManagement.jsx"), /localSections=\{\["modules", "screens"\]\} onSelect=\{setView\}/);
  assert.match(read("MenuManagement.jsx"), /localSections=\{\["areas", "menu"\]\} onSelect=\{setView\}/);
  assert.match(read("AccessRules.jsx"), /selectMode\("reparti"\)/);
});

test("catalogs scroll independently with readable counts and responsive fallback", () => {
  const css = read("modules-settings.css");
  assert.match(css, /\.module-settings-summary strong[^}]*color: #173a70/);
  assert.match(css, /\.module-settings-summary span[^}]*color: #34445b/);
  assert.match(css, /\.module-catalog-list \{[^}]*contain: size[^}]*overflow-y: auto/);
  assert.match(css, /max-width: 1100px[^\n]*contain: none/);
  assert.match(read("access-control.css"), /\.access-user-list \{[^}]*overflow-y: auto/);
});

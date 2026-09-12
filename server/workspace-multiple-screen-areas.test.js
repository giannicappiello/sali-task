import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { screenAreaCodes, screenMatchesArea } from "../src/config/workspaceScreenAreas.js";
import { screenAccessAllowed } from "../src/config/workspaceScreenAccess.js";
import { buildWorkspaceAssociations } from "../src/pages/Settings/workspaceCatalog.js";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const screen = { codice: "shared", area: "old", aree: ["ph", "pr"], attiva: true };
test("multiple areas replace legacy ownership without duplicates or remembered removals", () => {
  assert.deepEqual(screenAreaCodes(screen), ["ph", "pr"]);
  assert.deepEqual(screenAreaCodes({ area: "old", aree: ["pr", "pr"] }), ["pr"]);
  assert.deepEqual(screenAreaCodes({ area: "old", aree: [] }), []);
  assert.deepEqual(screenAreaCodes({ area: "ph" }), ["ph"]);
});
test("area filtering matches any associated area, never the stale compatibility value", () => {
  for (const code of ["ph", "pr", "all"]) assert.equal(screenMatchesArea(screen, code), true);
  assert.equal(screenMatchesArea(screen, "old"), false);
});
test("area panels count a shared screen once in each area, independent of its modules", () => {
  const result = buildWorkspaceAssociations({ screens: [screen], areas: ["ph", "pr", "old"].map(codice => ({ codice })) });
  assert.deepEqual(result.areaScreens.get("ph"), [screen]);
  assert.deepEqual(result.areaScreens.get("pr"), [screen]);
  assert.deepEqual(result.areaScreens.get("old"), []);
});
test("the second area can authorize a screen without granting a module", () => {
  const base = { screen, activeUser: true, admin: false, moduleAllowed: false, areaAllowed: screenAreaCodes(screen).some(code => code === "pr") };
  assert.equal(screenAccessAllowed(base), true);
  assert.equal(screenAccessAllowed({ ...base, exception: { decision: "nega" } }), false);
  assert.equal(screenAccessAllowed({ ...base, activeUser: false }), false);
});
test("navigation uses canonical screen decisions, not single-area filters", () => {
  const hook = read("src/hooks/useOrderedModuleScreens.js");
  assert.match(hook, /hasScreenAccess\(link.schermata_codice, moduleCode\)/);
  assert.doesNotMatch(hook, /hasAreaAccess/);
});
test("multi-selection, saved payload and selected-area catalog are all wired", () => {
  const editor = read("src/pages/Settings/ModuleManagement.jsx");
  assert.match(editor, /<ScreenAreaPicker/);
  assert.match(editor, /aree: screenAreaCodes\(screenForm\)/);
  assert.match(editor, /screenMatchesArea\(item, areaFilter\)/);
  assert.match(read("src/pages/Settings/MenuManagement.jsx"), /area,aree,provider/);
});
test("database guards all area references and updates the access snapshot", () => {
  const sql = read("supabase/migrations/20260912210000_workspace_multiple_screen_areas.sql");
  assert.match(sql, /on update restrict on delete restrict/);
  assert.match(sql, /s.aree && workspace_area_access_codes/);
  assert.match(sql, /'aree',s.aree/);
  assert.match(sql, /if not public.workspace_user_is_admin\(\)/);
  assert.match(sql, /cardinality\(selected_areas\)=0/);
  assert.match(sql, /for update/);
});

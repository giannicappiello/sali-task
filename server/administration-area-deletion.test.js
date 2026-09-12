import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
test("only Administration loses its deletion protection, without deleting data", () => {
  const sql = read("supabase/migrations/20260912111000_allow_empty_administration_area_deletion.sql");
  assert.match(sql, /set protetta = false/);
  assert.match(sql, /where codice = 'amministrazione' and protetta = true/);
  assert.doesNotMatch(sql, /delete from|drop constraint|disable trigger/i);
});
test("database still restricts area deletion while any module or screen references it", () => {
  const sql = read("supabase/migrations/20260820090000_workspace_areas_and_custom_menu.sql");
  for (const table of ["moduli", "schermate"]) {
    assert.match(sql, new RegExp("add constraint workspace_" + table + "_area_fkey foreign key \\(area\\)\\s+references public.workspace_aree\\(codice\\) on update cascade on delete restrict", "i"));
  }
});
test("UI checks both association counts before deletion and retains protected areas", () => {
  const source = read("src/pages/Settings/MenuManagement.jsx");
  const body = source.slice(source.indexOf("async function deleteArea()"), source.indexOf("async function saveMenu"));
  assert.match(body, /!isAdminUser \|\| !area \|\| area.protetta/);
  assert.match(body, /associations.areaModules.get\(area.codice\)/);
  assert.match(body, /associations.areaScreens.get\(area.codice\)/);
  assert.ok(body.indexOf("if (moduleCount || screenCount)") < body.indexOf('.delete()'));
});

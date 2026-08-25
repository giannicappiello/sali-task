import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("areas are a normalized authorization layer for modules and screens", async () => {
  const [migration, auth, editor, genericContainer, analytics] = await Promise.all([
    read("supabase/migrations/20260820090000_workspace_areas_and_custom_menu.sql"),
    read("src/contexts/AuthContext.jsx"),
    read("src/pages/Settings/ModuleManagement.jsx"),
    read("src/pages/Modules/WorkspaceModuleContainer.jsx"),
    read("src/modules/analytics/pages/AnalyticsHub.jsx"),
  ]);
  assert.match(migration, /create table if not exists public\.workspace_aree/);
  assert.match(migration, /workspace_moduli_area_fkey/);
  assert.match(migration, /workspace_schermate_area_fkey/);
  assert.match(migration, /workspace_reparti_aree/);
  assert.match(migration, /workspace_ruoli_aree/);
  assert.match(migration, /workspace_utenti_aree/);
  assert.match(migration, /workspace_area_access_codes/);
  assert.match(auth, /hasAreaAccess/);
  assert.match(auth, /moduleAreas\[moduleCode\]/);
  assert.match(editor, /workspace_aree/);
  assert.match(editor, /<label>Area<select required/);
  assert.match(genericContainer, /hasAreaAccess\(screen\.area\)/);
  assert.match(analytics, /hasAreaAccess\(screen\.area\)/);
});

test("custom menu entries can contain multiple modules and drive Home", async () => {
  const [migration, layout, menuEditor, menuContainer, home, app, settingsHub] = await Promise.all([
    read("supabase/migrations/20260820090000_workspace_areas_and_custom_menu.sql"),
    read("src/components/Layout.jsx"),
    read("src/pages/Settings/MenuManagement.jsx"),
    read("src/pages/Modules/WorkspaceMenuContainer.jsx"),
    read("src/pages/Home/Home.jsx"),
    read("src/App.jsx"),
    read("src/pages/Settings/SettingsHub.jsx"),
  ]);
  assert.match(migration, /create table if not exists public\.workspace_menu_voci/);
  assert.match(migration, /create table if not exists public\.workspace_menu_moduli/);
  assert.match(layout, /workspace_menu_voci/);
  assert.match(layout, /workspace_menu_moduli/);
  assert.match(layout, /members\.length === 1/);
  assert.match(layout, /catalogModule: module\.codice/);
  assert.match(layout, /item\.catalogModule \|\| item\.module/);
  assert.match(layout, /`\/menu\/\$\{entry\.codice\}`/);
  assert.match(menuEditor, /Lo stesso modulo può essere presente anche in altre voci di menu/);
  assert.match(menuContainer, /workspace_menu_moduli/);
  assert.match(menuContainer, /hasWorkspaceFeature\("analisi_dati"\)/);
  assert.match(home, /useOutletContext/);
  assert.match(app, /menu\/:menuCode/);
  assert.match(app, /settings\/menu/);
  assert.match(settingsHub, /impostazioni\.menu/);
});

test("screens and menu entries expose configurable icons throughout the workspace", async () => {
  const [migration, editor, menuEditor, moduleContainer, screenLayout, orderedScreens] = await Promise.all([
    read("supabase/migrations/20260820100000_workspace_screen_icons.sql"),
    read("src/pages/Settings/ModuleManagement.jsx"),
    read("src/pages/Settings/MenuManagement.jsx"),
    read("src/pages/Modules/WorkspaceModuleContainer.jsx"),
    read("src/components/WorkspaceScreenLayout.jsx"),
    read("src/hooks/useOrderedModuleScreens.js"),
  ]);
  assert.match(migration, /add column if not exists icona text not null default 'blocks'/);
  assert.match(migration, /icona=coalesce\(nullif\(btrim\(target_screen->>'icona'\)/);
  assert.match(editor, /WorkspaceIconPicker value=\{screenForm\.icona \|\| "blocks"\}/);
  assert.match(editor, /icona: cleanText\(screenForm\.icona\)/);
  assert.match(menuEditor, /Usata nel menu laterale, nella Home e nel contenitore della voce/);
  assert.match(moduleContainer, /getModuleIcon\(screen\.icona,LayoutGrid\)/);
  assert.match(screenLayout, /screenIcon: screen\?\.icona/);
  assert.match(orderedScreens, /workspace_schermate\(area,icona\)/);
});

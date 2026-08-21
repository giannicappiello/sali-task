import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("l'icona del modulo è configurabile e alimenta menu e contenitore", async () => {
  const [settings, layout, container, screenLayout, registry, migration] = await Promise.all([
    read("src/pages/Settings/ModuleManagement.jsx"),
    read("src/components/Layout.jsx"),
    read("src/pages/Modules/WorkspaceModuleContainer.jsx"),
    read("src/components/WorkspaceScreenLayout.jsx"),
    read("src/config/moduleIcons.jsx"),
    read("supabase/migrations/20260819242000_workspace_module_icons.sql"),
  ]);

  assert.match(settings, /MODULE_ICON_OPTIONS\.map/);
  assert.match(settings, /icona: cleanText\(form\.icona\)/);
  assert.match(layout, /ordine,icona/);
  assert.match(layout, /getModuleIcon\(module\.icona/);
  assert.match(container, /tipo,icona/);
  assert.match(container, /icon=\{ModuleIcon\}/);
  assert.match(screenLayout, /attivo,icona/);
  assert.match(screenLayout, /getModuleIcon\(presentation\.moduleIcon/);
  assert.match(screenLayout, /icon=\{ModuleIcon\}/);
  assert.match(registry, /shopping-bag/);
  assert.match(registry, /ShoppingCart/);
  assert.match(migration, /add column if not exists icona/);
  assert.match(migration, /icona=excluded\.icona/);
});

test("la barra superiore espone il pulsante Home accanto alle notifiche", async () => {
  const [layout, styles] = await Promise.all([
    read("src/components/Layout.jsx"),
    read("src/styles/App.css"),
  ]);

  assert.match(layout, /className="topbar-home-btn"/);
  assert.match(layout, /navigate\("\/home"\)/);
  assert.match(layout, /topbar-home-btn[\s\S]*notification-btn/);
  assert.match(styles, /\.topbar-home-btn/);
});

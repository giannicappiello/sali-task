import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("screen builder schema is additive, versioned, audited and admin-only", async () => {
  const migration = await read("supabase/migrations/20260827160000_workspace_screen_builder.sql");
  assert.match(migration, /create table if not exists public\.workspace_builder_layouts/i);
  assert.match(migration, /create table if not exists public\.workspace_builder_versions/i);
  assert.match(migration, /create table if not exists public\.workspace_builder_audit_log/i);
  assert.match(migration, /workspace_user_is_admin\(\)/);
  assert.match(migration, /workspace_validate_builder_layout/);
  assert.match(migration, /jsonb_array_length\(target_blocks\) > 40/);
  assert.match(migration, /identificatore univoco/i);
  assert.match(migration, /Destinazione pulsante/i);
  assert.match(migration, /'screen_cloned'/);
  assert.match(migration, /enable row level security/);
});

test("builder exposes controlled blocks, responsive preview and save-as-new", async () => {
  const builder = await read("src/pages/Settings/ScreenBuilder.jsx");
  assert.match(builder, /system-content/);
  assert.match(builder, /type: "button"/);
  assert.match(builder, /type: "links"/);
  assert.match(builder, /Salva e pubblica/);
  assert.match(builder, /Salva come nuova/);
  assert.match(builder, /setViewport\("mobile"\)/);
  assert.match(builder, /admin_clone_workspace_builder_screen/);
  assert.match(builder, /selected\.type === "system-content"/);
  assert.match(builder, /restoreVersion/);
});

test("published layouts are opt-in and preserve specialist application content", async () => {
  const [layout, composition, config, app, modules, menus] = await Promise.all([
    read("src/components/WorkspaceScreenLayout.jsx"),
    read("src/components/WorkspaceScreenComposition.jsx"),
    read("src/components/workspaceScreenLayoutConfig.js"),
    read("src/App.jsx"),
    read("src/pages/Settings/ModuleManagement.jsx"),
    read("src/pages/Settings/MenuManagement.jsx"),
  ]);
  assert.match(layout, /workspace_builder_layouts/);
  assert.match(layout, /layoutRequiresSystemContent/);
  assert.match(composition, /normalizeWorkspaceLayout/);
  assert.match(config, /requireSystemContent/);
  assert.match(composition, /safeDestination/);
  assert.match(app, /settings\/layout-builder\/:targetType\/:targetCode/);
  assert.match(app, /workspace\/schermate\/:screenCode/);
  assert.match(modules, /layout-builder\/module/);
  assert.match(modules, /layout-builder\/screen/);
  assert.match(modules, /builderTarget/);
  assert.match(menus, /layout-builder\/menu/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [layout, home, analytics, analyticsRoutes, team, settings, migration, cleanupMigration] = await Promise.all([
  readFile("src/components/Layout.jsx", "utf8"),
  readFile("src/pages/Home/Home.jsx", "utf8"),
  readFile("src/modules/analytics/pages/AnalyticsHub.jsx", "utf8"),
  readFile("src/modules/analytics/AnalyticsModule.jsx", "utf8"),
  readFile("src/pages/Team/Team.jsx", "utf8"),
  readFile("src/pages/Settings/Settings.jsx", "utf8"),
  readFile("supabase/migrations/20260818130000_workspace_module_catalog_and_role_levels.sql", "utf8"),
  readFile("supabase/migrations/20260819235000_cleanup_legacy_and_derived_modules.sql", "utf8"),
]);

test("ProgreMES keeps a temporary authorized launcher during the transition", () => {
  assert.match(layout, /workspace:launch-progremes/);
  assert.match(layout, /hasModuleAccess\("progremes"\)/);
  assert.match(home, /workspace:launch-progremes/);
});

test("analytics cards declare source-module dependencies", () => {
  assert.match(analytics, /metadati\?\.source_module/);
  assert.match(analytics, /metadati\?\.required_module/);
  assert.doesNotMatch(analytics, /SOURCE_MODULE_BY_SCREEN/);
  assert.match(cleanupMigration, /'analisi\.fatture', 'ordini_pr'/);
  assert.match(cleanupMigration, /'analisi\.ordini_ph', 'ordini_ph'/);
  assert.match(cleanupMigration, /'analisi\.beauty_days', 'beauty_days'/);
  assert.match(analyticsRoutes, /moduleCode="ordini_pr"/);
  assert.match(analyticsRoutes, /moduleCode="ordini_ph"/);
  assert.match(analyticsRoutes, /moduleCode="beauty_days"/);
});

test("Team loads only users visible through shared departments", () => {
  assert.match(team, /visible_workspace_team_user_ids/);
  assert.match(migration, /member_departments[\s\S]*join my_departments/);
});

test("roles configure module-specific operational levels", () => {
  assert.match(settings, /Operatività per modulo/);
  assert.match(settings, /roleConfigurableModules/);
  assert.match(settings, /from\("workspace_moduli"\)/);
  assert.match(migration, /create table if not exists public\.ruoli_moduli/);
  assert.match(migration, /'module_levels'/);
});

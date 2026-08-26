import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the workspace exposes one role and relationship based data scope", async () => {
  const [migration, auth] = await Promise.all([
    read("supabase/migrations/20260819230000_workspace_data_scope.sql"),
    read("src/contexts/AuthContext.jsx"),
  ]);

  assert.match(migration, /create or replace function public\.workspace_data_scope\(\)/i);
  assert.match(migration, /ambito_dati/);
  assert.match(migration, /responsabile_utente_id/);
  assert.match(migration, /workspace_utente_id/);
  assert.match(migration, /'department_ids'/);
  assert.match(migration, /'user_ids'/);
  assert.match(migration, /'agent_ids'/);
  assert.match(auth, /supabase\.rpc\("workspace_data_scope"\)/);
  assert.match(auth, /function canViewScopedData/);
});

test("activity screens filter records without hiding their module or routes", async () => {
  const sources = await Promise.all([
    read("src/pages/Dashboard/Dashboard.jsx"),
    read("src/pages/Agenda/Agenda.jsx"),
    read("src/pages/Projects/Projects.jsx"),
    read("src/pages/Tasks/Tasks.jsx"),
  ]);

  for (const source of sources) {
    assert.match(source, /canViewScopedData/);
    assert.match(source, /dataScope/);
    assert.match(source, /selectableDepartmentIds/);
  }

  const dashboard = sources[0];
  assert.match(dashboard, /v4_progetto_reparti/);
  assert.match(dashboard, /setProjects\(visibleProjects\)/);
  assert.match(dashboard, /visiblePhaseIds\.has\(row\.fase_id\)/);
});

test("non-admin activity visibility requires personal ownership or a direct department link", async () => {
  const [auth, projects, tasks, normalization] = await Promise.all([
    read("src/contexts/AuthContext.jsx"),
    read("src/pages/Projects/Projects.jsx"),
    read("src/pages/Tasks/Tasks.jsx"),
    read("supabase/migrations/20260819233000_strict_activity_department_scope.sql"),
  ]);
  assert.match(auth, /ownerId === profile\.id/);
  assert.doesNotMatch(auth, /visibleUsers\.has\(ownerId\)/);
  assert.match(projects, /directlyVisiblePhases/);
  assert.match(tasks, /directlyVisiblePhases/);
  assert.match(projects, /projectDepartmentIdsByProject = new Map/);
  assert.match(tasks, /phaseDepartmentIdsByPhase = new Map/);
  assert.doesNotMatch(projects, /canReadAllTasksInVisibleProjects/);
  assert.doesNotMatch(tasks, /canReadAllTasksInVisibleProjects/);
  assert.match(normalization, /ambito_dati = 'team'/);
  assert.match(normalization, /fieldforce/);
  assert.match(normalization, /beauty%consult/);
});

test("legacy activity screens inherit the shared module and screen layouts", async () => {
  const [activityModule, screenLayout] = await Promise.all([
    read("src/pages/Activities/ActivitiesModule.jsx"),
    read("src/components/WorkspaceScreenLayout.jsx"),
  ]);
  assert.doesNotMatch(activityModule, /activities-module-header/);
  assert.match(screenLayout, /navigationParent/);
  assert.doesNotMatch(screenLayout, /defaultModuleScreen/);
  assert.match(screenLayout, /workspace-screen-content/);
});

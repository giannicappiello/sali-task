import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20260912230000_role_relationship_data_scope.sql');
const scope = migration.slice(migration.indexOf('create or replace function public.workspace_data_scope'), migration.indexOf('create or replace function public.crm_row_visible'));

test('relationship scope uses role configuration, not names, IDs or legacy primary departments', () => {
  assert.match(scope, /r\.ambito_team/);
  assert.doesNotMatch(scope, /Nuzzo|Annecchino|De Angelis|Merino|r\.nome|u\.reparto_id/i);
  assert.match(scope, /s\.team_scope = 'reparti'/);
  assert.match(scope, /s\.team_scope = 'gerarchia'/);
  assert.match(scope, /i\.enabled is true/);
});
test('hierarchy is cycle-safe; agent associations do not recursively add unrelated associations', () => {
  assert.match(scope, /union -- UNION \(not ALL\)/);
  assert.doesNotMatch(scope, /union all/i);
  const agents = scope.slice(scope.indexOf('agents as materialized'), scope.indexOf('members as materialized'));
  assert.match(agents, /from base_members/);
  assert.doesNotMatch(agents, /from members\)/);
});
test('role editor loads, saves and exposes all organizational scope choices', () => {
  const ui = read('../src/pages/Settings/AccessRules.jsx');
  assert.match(ui, /ambito_dati,ambito_team,livello_accesso/);
  assert.match(ui, /ambito_team: form\.ambito_team/);
  for (const choice of ['reparti', 'gerarchia', 'associazioni']) assert.ok(ui.includes(`option value="${choice}"`));
});
test('excluded customers remain excluded and commercial all does not alter operational agents', () => {
  assert.match(migration, /customer\.sync_excluded is false/);
  assert.doesNotMatch(migration, /update public\.(ordini_clienti_cache|utenti)|delete from/i);
  assert.match(scope, /'commercial_mode', case when public\.workspace_commercial_read_all\(\)/);
  assert.match(scope, /when customer_code is not null then 'cliente'/);
});
test('agent reassignment invalidates sessions, but routine sync timestamps do not', () => {
  assert.match(migration, /after update of responsabile_utente_id,workspace_utente_id,attivo_mexal,codice/);
  assert.match(migration, /old\.responsabile_utente_id is distinct from new\.responsabile_utente_id/);
  assert.doesNotMatch(migration, /after insert or update or delete on public\.mexal_agenti/);
});
test('verification generator installs candidate functions only in a rollback-isolated schema', () => {
  const sql = execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/role-relationship-scope-verification.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.match(sql, /^begin;/);
  assert.match(sql, /create or replace function pg_temp\.workspace_data_scope/);
  assert.doesNotMatch(sql, /create or replace function public\.|update public\.|alter table public\./);
  assert.match(sql, /rollback;$/);
});

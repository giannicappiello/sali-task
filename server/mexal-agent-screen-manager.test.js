import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260914110000_mexal_agent_screen_manager_visibility.sql', import.meta.url), 'utf8');
const automation = readFileSync(new URL('../api/mexal/automation.js', import.meta.url), 'utf8');

test('agent management visibility is tied to management of the exact screen', () => {
  assert.match(migration, /workspace_screen_level_for_user\(u\.id, 'integrazioni\.mexal_agenti'\) = 'amministrazione'/);
  assert.match(migration, /attivo_mexal is not false and \(select public\.workspace_can_manage_mexal_agents\(\)\)/);
  assert.match(migration, /workspace_commercial_read_all\(\)/);
  assert.match(migration, /workspace_team_agent_visible\(codice\)/);
});

test('agent access endpoint accepts the screen manager instead of only global admins', () => {
  const route = automation.slice(automation.indexOf('case "agents_access"'), automation.indexOf('case "oct_precheck"'));
  assert.match(route, /createScreenManager\(req, "integrazioni\.mexal_agenti"\)/);
  assert.doesNotMatch(route, /createAdmin\(req\)/);
});

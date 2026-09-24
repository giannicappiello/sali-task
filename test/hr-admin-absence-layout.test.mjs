import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const moduleSource = fs.readFileSync('src/modules/hr/HrModule.jsx', 'utf8');
const styles = fs.readFileSync('src/modules/hr/hr.css', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260924180000_workspace_hr_admin_absences.sql', 'utf8');

test('HR admin absence flow exposes the four supported absence causes', () => {
  assert.match(moduleSource, /Nuova assenza/);
  assert.match(moduleSource, /workspace_hr_admin_request/);
  assert.match(moduleSource, /\['illness', 'Malattia'\]/);
  assert.match(moduleSource, /\['pregnancy', 'Gravidanza'\]/);
});

test('HR admin absence persistence is authorization-checked and immediately approved', () => {
  assert.match(migration, /workspace_hr_admin_request/);
  assert.match(migration, /workspace_user_is_admin\(\)/);
  assert.match(migration, /workspace_hr_members where user_id=target and active/);
  assert.match(migration, /values\(request_id,target,kind,starts_at,ends_at,note,'approved'/);
  assert.match(migration, /revoke all on function public\.workspace_hr_admin_request/);
});

test('weekly HR calendar keeps all person/status content while using compact spacing', () => {
  assert.match(moduleSource, /Calendario presenze settimanale/);
  assert.match(moduleSource, /Presenti/);
  assert.match(moduleSource, /Assenti/);
  assert.match(moduleSource, /Assegna turno/);
  assert.match(styles, /\.hr-week-day\{[^}]*padding:8px;min-height:220px/);
  assert.match(styles, /\.hr-week-person\{[^}]*padding:5px 0/);
});

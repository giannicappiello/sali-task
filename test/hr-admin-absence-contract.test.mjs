import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('client and database agree on the admin absence RPC contract', async () => {
  const [service, migration, verification] = await Promise.all([
    read('src/modules/hr/hrService.js'),
    read('supabase/migrations/20260924180000_workspace_hr_admin_absences.sql'),
    read('supabase/migrations/20260924190000_verify_workspace_hr_admin_absence_rpc.sql'),
  ]);

  assert.match(service, /workspace_hr_admin_request/);
  assert.match(service, /p_data jsonb/);
  assert.match(migration, /create or replace function public\.workspace_hr_admin_request\(p_data jsonb\)/);
  assert.match(migration, /grant execute on function public\.workspace_hr_admin_request\(jsonb\) to authenticated/);
  assert.match(migration, /notify pgrst/);
  assert.match(verification, /to_regprocedure\('public\.workspace_hr_admin_request\(jsonb\)'\)/);
  assert.match(verification, /array\['p_data'\]::text\[\]/);
  assert.match(verification, /has_function_privilege\('authenticated'/);
});

test('schema-cache RPC failures remain visible as an operational UI error', async () => {
  const service = await read('src/modules/hr/hrService.js');
  assert.match(service, /RPC_SCHEMA_CACHE_ERROR/);
  assert.match(service, /servizio HR non è allineato in produzione/);
  assert.match(service, /schema PostgREST ricaricato/);
  assert.doesNotMatch(service, /catch \(.*\)\s*\{\s*return/);
});

test('production deployment applies migrations before publishing the frontend', async () => {
  const script = await read('scripts/deploy-production.mjs');
  const migrationPush = script.indexOf('"db", "push", "--linked", "--yes"');
  const frontendDeploy = script.indexOf('"vercel", "deploy", "--prod", "--yes"');
  assert.ok(migrationPush >= 0);
  assert.ok(frontendDeploy > migrationPush);
});

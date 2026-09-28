import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceAuthFailure } from './workspace-auth-diagnostic.js';

test('auth diagnostics preserve invalid-session rejection and exclude sensitive details', t => {
  const logs = [];
  t.mock.method(console, 'warn', (...args) => logs.push(args));
  const failure = workspaceAuthFailure({ status: 403, code: 'bad_jwt', message: 'secret-token', user: 'private-user' }, 'planning-workspace', 'Sessione non valida.');
  assert.equal(failure.status, 401);
  assert.equal(failure.message, 'Sessione non valida.');
  assert.deepEqual(logs, [['[workspace-auth]', { context: 'planning-workspace', providerStatus: 403, code: 'bad_jwt' }]]);
});

test('provider outages remain rejected but do not demand another login', t => {
  t.mock.method(console, 'warn', () => {});
  for (const error of [{ status: 503 }, { status: 429 }, { name: 'AuthRetryableFetchError' }]) {
    assert.equal(workspaceAuthFailure(error, 'progremes-sso', 'Sessione non valida.').status, 503);
  }
  assert.equal(workspaceAuthFailure(null, 'progremes-sso', 'Sessione non valida.').status, 401);
});

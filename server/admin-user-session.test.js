import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeAdminUser } from '../src/lib/adminUserRequest.js';
import { adminAuthFailure } from '../supabase/functions/admin-manage-user/auth-failure.js';

const session = (token = 'old', seconds = 3600, id = 'admin') => ({ access_token: token, expires_at: Date.now() / 1000 + seconds, user: { id } });
const rejected = status => ({ data: null, error: { context: { status }, message: 'Rejected' } });
function fixture({ current = session(), refreshed = session('fresh'), refreshError = null, results = [{ data: { ok: true }, error: null }] } = {}) {
  const calls = []; let refreshes = 0;
  const client = {
    auth: { getSession: async () => ({ data: { session: current } }), refreshSession: async () => { refreshes++; return { data: { session: refreshed }, error: refreshError }; } },
    functions: { invoke: async (name, options) => { calls.push({ name, options }); const result = results[calls.length - 1]; if (result instanceof Error) throw result; return result; } },
  };
  return { client, calls, refreshes: () => refreshes };
}
const options = { body: { action: 'update', id: 'target', password: 'test-only' } };
test('valid session sends explicit current caller token once', async () => {
  const f = fixture(); assert.equal((await invokeAdminUser(f.client, options)).error, null);
  assert.equal(f.calls.length, 1); assert.equal(f.refreshes(), 0);
  assert.equal(f.calls[0].options.headers.Authorization, 'Bearer old');
  assert.equal(f.calls[0].options.body, options.body);
});
test('near-expiry session renews before sending credentials', async () => {
  const f = fixture({ current: session('old', 15) }); await invokeAdminUser(f.client, options);
  assert.equal(f.refreshes(), 1); assert.equal(f.calls[0].options.headers.Authorization, 'Bearer fresh');
});
test('authentication rejection renews and retries exactly once with the new token', async () => {
  const f = fixture({ results: [rejected(401), { data: { ok: true }, error: null }] });
  assert.equal((await invokeAdminUser(f.client, options)).data.ok, true);
  assert.equal(f.refreshes(), 1); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].options.headers.Authorization, 'Bearer fresh');
  assert.equal(f.calls[1].options.body, options.body);
});
test('repeated 401 stops and explains that sign-in is required', async () => {
  const f = fixture({ results: [rejected(401), rejected(401)] });
  const result = await invokeAdminUser(f.client, options);
  assert.equal(result.error.status, 401); assert.match(result.error.message, /Accedi nuovamente/);
  assert.equal(f.calls.length, 2); assert.equal(f.refreshes(), 1);
});
for (const status of [400, 403, 409, 429, 500, 503]) test('never replays a user mutation after HTTP ' + status, async () => {
  const result = rejected(status); const f = fixture({ results: [result] });
  assert.equal(await invokeAdminUser(f.client, options), result);
  assert.equal(f.calls.length, 1); assert.equal(f.refreshes(), 0);
});
test('ambiguous transport failures never replay a password change or account creation', async () => {
  const f = fixture({ results: [new Error('network')] });
  assert.equal((await invokeAdminUser(f.client, options)).error.message, 'network');
  assert.equal(f.calls.length, 1); assert.equal(f.refreshes(), 0);
});
test('missing session never sends credentials', async () => {
  const f = fixture({ current: null }); assert.equal((await invokeAdminUser(f.client, options)).error.status, 401);
  assert.equal(f.calls.length, 0);
});
test('failed refresh does not retry the mutation', async () => {
  const f = fixture({ refreshError: { status: 400 }, results: [rejected(401)] });
  assert.equal((await invokeAdminUser(f.client, options)).error.status, 401); assert.equal(f.calls.length, 1);
});
test('temporary refresh failure is not reported as expired login', async () => {
  const f = fixture({ current: session('old', 15), refreshError: { status: 503 } });
  const result = await invokeAdminUser(f.client, options);
  assert.equal(result.error.status, 503); assert.match(result.error.message, /temporaneamente/); assert.equal(f.calls.length, 0);
});
test('account switch during refresh cannot replay an administrator request', async () => {
  const f = fixture({ refreshed: session('fresh', 3600, 'other'), results: [rejected(401)] });
  assert.equal((await invokeAdminUser(f.client, options)).error.status, 401); assert.equal(f.calls.length, 1);
});
test('server distinguishes temporary auth failures and emits only safe metadata', () => {
  const original = console.warn; const logs = []; console.warn = (...args) => logs.push(args);
  try {
    for (const error of [{ status: 429 }, { status: 500 }, { name: 'AuthRetryableFetchError' }]) {
      const result = adminAuthFailure({ ...error, message: 'PRIVATE', token: 'PRIVATE', code: 'unavailable' });
      assert.equal(result.status, 503); assert.match(result.body.error, /temporaneamente/);
    }
    assert.equal(adminAuthFailure({ status: 401, code: 'bad_jwt', message: 'PRIVATE' }).status, 401);
    assert.equal(JSON.stringify(logs).includes('PRIVATE'), false);
  } finally { console.warn = original; }
});

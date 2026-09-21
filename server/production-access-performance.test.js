import test from 'node:test';
import assert from 'node:assert/strict';
import { costSession } from './production-costs.js';

function fixture({ level = 'lettura', active = true, scope = { mode: 'cliente', customer_codes: ['A'] }, error = null } = {}) {
  const calls = [];
  const query = { select() { return this; }, eq() { return this; },
    async maybeSingle() { return { data: { id: 'profile', attivo: active } }; } };
  return { calls, clientFactory(_url, _key, options) {
    const authorization = options.global?.headers.Authorization;
    return { auth: { async getUser(token) { calls.push(['auth', token]); return { data: { user: { id: 'auth-user' } } }; } },
      from() { return query; },
      async rpc(name, args) {
        calls.push([name, authorization, args]);
        if (name === 'workspace_screen_level_for_user') return { data: level };
        assert.equal(name, 'workspace_data_scope', 'must not compute the entire screen catalogue');
        assert.equal(authorization, 'Bearer verified-token', 'scope must use the caller, never the service identity');
        return { data: scope, error };
      } };
  } };
}
const req = { headers: { authorization: 'Bearer verified-token' } };

test('targeted authorization preserves customer scope without full session catalogue', async () => {
  const f = fixture();
  const result = await costSession(req, 'progremes.Produzione', false, f);
  assert.deepEqual(result.scope, { mode: 'cliente', customer_codes: ['A'] });
  assert.equal(result.canWrite, false);
  assert.equal(f.calls.length, 3);
});

test('revocation, inactive profiles and write restrictions still fail closed', async () => {
  for (const [options, write] of [[{ level: 'nessuno' }, false], [{ active: false }, false], [{}, true], [{ scope: null }, false]]) {
    await assert.rejects(costSession(req, 'progremes.Produzione', write, fixture(options)), { status: 403 });
  }
  const f = fixture({ level: 'scrittura' });
  assert.equal((await costSession(req, 'progremes.Produzione', true, f)).canWrite, true);
  await costSession(req, 'progremes.Produzione', true, f);
  assert.equal(f.calls.filter(c => c[0] === 'auth').length, 2, 'authorization is fresh on each request');
});

test('scope database errors are not replaced with unrestricted access', async () => {
  await assert.rejects(costSession(req, 'progremes.Produzione', false, fixture({ error: new Error('scope unavailable') })), /scope unavailable/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionActionsHandler } from '../api/production/actions.js';

function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
}
test('dedicated route accepts only production actions and never caches permission results', async () => {
  let calls = 0;
  const handler = createProductionActionsHandler({ preparation_actions: async (req, body) => {
    calls++; assert.equal(req.headers.authorization, 'Bearer caller'); assert.equal(body.operation, 'context');
    return { ready: true, canWrite: false };
  } });
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer caller' },
    body: { action: 'preparation_actions', operation: 'context' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, ready: true, canWrite: false });
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  for (const action of ['toString', '__proto__', 'delete', 'production_costs']) {
    const rejected = response();
    await handler({ method: 'POST', body: { action } }, rejected);
    assert.equal(rejected.statusCode, 400);
  }
  const get = response(); await handler({ method: 'GET' }, get);
  assert.equal(get.statusCode, 405); assert.equal(calls, 1);
});
test('authorization errors propagate without success or cached fallback', async () => {
  const handler = createProductionActionsHandler({ preparation_actions: async () => {
    throw Object.assign(new Error('Revocato'), { status: 403 });
  } });
  const res = response(); await handler({ method: 'POST', body: { action: 'preparation_actions' } }, res);
  assert.equal(res.statusCode, 403); assert.equal(res.body.success, false);
});

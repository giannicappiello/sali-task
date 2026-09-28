import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyUser as clients } from './sync-clients.js';
import { verifyUser as products } from './sync-products.js';

const req = { headers: { authorization: 'Bearer delegated-user' } };
function db(allowed, failure = null) {
  const profile = { id: 'noemi', attivo: true, ruoli: { amministratore_workspace: false } };
  const calls = [];
  return { calls, auth: { getUser: async () => ({ data: { user: { id: 'auth' } } }) },
    rpc: async (name, args) => { calls.push(args.permission_code); return { data: allowed, error: failure }; },
    from(table) {
      return { select() { return this; }, eq() { return this; },
        maybeSingle: async () => ({ data: profile }), limit: async () => ({ data: [profile] }),
        in: async () => ({ data: [] }) };
    } };
}
for (const code of ['clients', 'products', 'stocks']) {
  const verify = (database) => code === 'clients' ? clients(req, database) : products(req, database, { syncPermission: `integrations.sync.${code}` });
  test(`${code}: delegated sync user without orders access is authorized`, async () => {
    const database = db(true);
    await verify(database);
    assert.deepEqual(database.calls, [`integrations.sync.${code}`]);
  });
  test(`${code}: missing permission and orders access is rejected`, async () => {
    await assert.rejects(verify(db(false)), { status: 403 });
  });
  test(`${code}: permission lookup failure fails closed`, async () => {
    await assert.rejects(verify(db(false, { message: 'offline' })), { status: 503 });
  });
}
test('sync permission does not grant order operations', async () => {
  const database = db(true);
  await assert.rejects(products(req, database, { allowOrdersUser: true }), { status: 403 });
  assert.deepEqual(database.calls, []);
});

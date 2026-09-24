import test from 'node:test';
import assert from 'node:assert/strict';
import { readOperationalData, operationalReadTools } from './operational-read.js';
const reader = module => ({ profile: { ruoli: {} }, capabilities: { internal_data: true, allowed_modules: [module] }, access: { modules: [module] }, scoped: { rpc() { assert.fail('Unauthorized call'); } } });
test('HR never exposes agreements to a non-admin or crosses AI module scope', async () => {
  await assert.rejects(readOperationalData(reader('human_resources'), 'hr', { month: '2026-09-01', configuration: true }), { status: 403 });
  await assert.rejects(readOperationalData(reader('prodotti'), 'hr', { month: '2026-09-01' }), { status: 403 });
  assert.equal(operationalReadTools(reader('prodotti')).HR_READ, undefined);
});
test('CRM rejects invalid dates and arbitrary CRM types before calling the database', async () => {
  const auth = reader('crm_b2b');
  await assert.rejects(readOperationalData(auth, 'customers', { type: 'constructor' }), { status: 403 });
  await assert.rejects(readOperationalData(auth, 'customers', { type: 'b2b', from: '2026-02-30', to: '2026-03-01' }), /Data non valida/);
});
test('operational reads reuse only authorized UI RPCs and preserve pagination', async () => {
  const auth = reader('crm_b2b');
  auth.scoped.rpc = (name, args) => {
    assert.equal(name, 'crm_customer_metric_details'); assert.equal(args.p_search, '501.03360'); assert.equal(args.p_crm_type, 'b2b');
    return { range: async (from, to) => { assert.equal(from, 50); assert.equal(to, 100); return { data: Array.from({ length: 51 }, (_, id) => ({ id })) }; } };
  };
  const result = await readOperationalData(auth, 'customers', { type: 'b2b', from: '2026-01-01', to: '2026-09-23', query: '501.03360', offset: 50 });
  assert.equal(result.data.length, 50); assert.equal(result.nextOffset, 100);
});

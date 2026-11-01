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
    assert.equal(args.p_limit, 51); assert.equal(args.p_offset, 50);
    return Promise.resolve({ data: Array.from({ length: 51 }, (_, id) => ({ id, agente_classificazione: 'Anna Purpura' })) });
  };
  const result = await readOperationalData(auth, 'customers', { type: 'b2b', from: '2026-01-01', to: '2026-09-23', query: '501.03360', offset: 50 });
  assert.equal(result.data.length, 50); assert.equal(result.nextOffset, 100);
  assert.equal(result.data[0].agente_classificazione, 'Anna Purpura');
});

test('SQL pagination reaches the last CRM page without applying a second offset', async () => {
  const auth = reader('crm_b2b');
  auth.scoped.rpc = (name, args) => {
    assert.equal(args.p_limit, 51); assert.equal(args.p_offset, 200);
    return Promise.resolve({ data: [{ codice_cliente: '501.01893' }] });
  };
  const result = await readOperationalData(auth, 'customers', { type: 'b2b', from: '2026-08-04', to: '2026-11-01', status: 'all', offset: 200 });
  assert.equal(result.data.length, 1); assert.equal(result.nextOffset, null);
});

test('PR reuses dashboard customer scope, keeps MyPharma separate and preserves agent names', async () => {
  const auth = reader('crm_b2b'); auth.access.modules.push('ordini_pr'); auth.capabilities.allowed_modules.push('ordini_pr');
  auth.scoped.rpc = (name, args) => {
    assert.equal(name, 'crm_b2b_order_customer_details');
    assert.equal(args.p_order_module, 'prof'); assert.equal(args.p_customer_group, 'regular');
    assert.equal(args.p_agent, '602.00040'); assert.equal(args.p_customer_status, 'all');
    assert.equal(args.p_limit, 51); assert.equal(args.p_offset, 0);
    return Promise.resolve({ data: [{ agente_classificazione: 'Anna Purpura', invoice_total: 1820.33, order_total: 360.98 }] });
  };
  const result = await readOperationalData(auth, 'customers', { type: 'b2b', from: '2026-08-04', to: '2026-11-01', status: 'all', orderModule: 'prof', agent: '602.00040' });
  assert.equal(result.source, 'crm_b2b_order_customer_details');
  assert.equal(result.data[0].agente_classificazione, 'Anna Purpura'); assert.equal(result.data[0].order_total, 360.98);
});

test('PH and explicit MyPharma scopes reach their existing dashboard overloads', async () => {
  const auth = reader('crm_b2b'); auth.access.modules.push('ordini_pr', 'ordini_ph'); auth.capabilities.allowed_modules.push('ordini_pr', 'ordini_ph');
  for (const [orderModule, customerGroup] of [['ph', 'all'], ['prof', 'mypharma']]) {
    auth.scoped.rpc = (name, args) => {
      assert.equal(name, 'crm_b2b_order_customer_details'); assert.equal(args.p_customer_group, customerGroup);
      assert.equal(args.p_order_module, orderModule); return Promise.resolve({ data: [] });
    };
    const result = await readOperationalData(auth, 'customers', { type: 'b2b', from: '2026-08-04', to: '2026-11-01', orderModule, customerGroup });
    assert.equal(result.nextOffset, null);
  }
});

test('order-specific CRM reads cannot cross module or AI scope or silently ignore filters', async () => {
  const input = { type: 'b2b', from: '2026-08-04', to: '2026-11-01', orderModule: 'prof' };
  await assert.rejects(readOperationalData(reader('crm_b2b'), 'customers', input), { status: 403 });
  const auth = reader('crm_b2b'); auth.access.modules.push('ordini_pr');
  await assert.rejects(readOperationalData(auth, 'customers', input), { status: 403 });
  auth.capabilities.allowed_modules.push('ordini_pr');
  await assert.rejects(readOperationalData(auth, 'customers', { ...input, orderModule: 'private' }), /Perimetro/);
  await assert.rejects(readOperationalData(auth, 'customers', { ...input, customerGroup: 'other' }), /Gruppo/);
  await assert.rejects(readOperationalData(auth, 'customers', { ...input, orderModule: undefined, customerGroup: 'regular' }), /Specificare/);
  await assert.rejects(readOperationalData(auth, 'customers', { ...input, orderModule: undefined, agent: '602.00040' }), /Specificare/);
});

test('CRM database failures propagate without a successful or empty result', async () => {
  const auth = reader('crm_b2b');
  const failure = new Error('RPC unavailable');
  auth.scoped.rpc = () => Promise.resolve({ data: null, error: failure });
  await assert.rejects(readOperationalData(auth, 'customers', { type: 'b2b', from: '2026-08-04', to: '2026-11-01' }), failure);
});

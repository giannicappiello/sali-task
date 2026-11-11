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

test('known CRM argument errors are actionable 400 INVALID_ARGUMENT and never reach RPC',async()=>{
 let calls=0;
 const auth={...reader('crm_b2b'),capabilities:{internal_data:true,allowed_modules:['crm_b2b','ordini_ph','ordini_pr']},access:{modules:['crm_b2b','ordini_ph','ordini_pr']},scoped:{rpc(){calls++;throw new Error('RPC must not run');}}};
 const base={type:'b2b',from:'2026-10-01',to:'2026-10-31',orderModule:'ph',customerGroup:'all',agent:'602.00069',status:'all',offset:0};
 for(const changed of [{customerGroup:'regular'},{from:'2026-02-30'},{from:'2026-11-01'},{from:'2024-01-01'},{offset:100001},{status:'unknown'},{orderModule:'unknown'},{orderModule:undefined}]){
  await assert.rejects(readOperationalData(auth,'customers',{...base,...changed}),{status:400,code:'INVALID_ARGUMENT'});
 }
 assert.equal(calls,0);
});

test('corrected PH scope reaches exactly one mocked RPC with original report parameters',async()=>{
 const auth=reader('crm_b2b');auth.access.modules.push('ordini_ph');auth.capabilities.allowed_modules.push('ordini_ph');let calls=0;
 auth.scoped.rpc=(name,args)=>{calls++;assert.equal(name,'crm_b2b_order_customer_details');assert.equal(args.p_customer_group,'all');assert.equal(args.p_order_module,'ph');assert.equal(args.p_agent,'602.00069');assert.equal(args.p_from,'2026-10-01');assert.equal(args.p_to,'2026-10-31');return Promise.resolve({data:[]});};
 await readOperationalData(auth,'customers',{type:'b2b',from:'2026-10-01',to:'2026-10-31',orderModule:'ph',customerGroup:'all',agent:'602.00069',status:'all',offset:0});
 assert.equal(calls,1);
});
test('CRM provider errors are not relabeled as safely retryable argument failures',async()=>{
 const auth=reader('crm_b2b');const providerError={code:'42501',message:'synthetic provider denial'};
 auth.scoped.rpc=async()=>({error:providerError});
 await assert.rejects(readOperationalData(auth,'customers',{type:'b2b',from:'2026-10-01',to:'2026-10-31'}),error=>error===providerError);
});
test('HR date validation retains its existing error contract',async()=>{
 await assert.rejects(readOperationalData(reader('hr'),'hr',{month:'bad'}),error=>error.message.includes('Data non valida')&&error.status===undefined&&error.code===undefined);
});

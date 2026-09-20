import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePreparationActions, preparationInput } from './preparation-actions.js';
import { mixingDepartmentAccess } from './mixing-access.js';

test('preparation validates order, operation, machine and print snapshot; strips actor and force flags', () => {
  for (const body of [{ productionOrderId: -1, operation: 'start' }, { productionOrderId: 1, operation: 'delete' },
    { productionOrderId: 1, operation: 'start' }, { productionOrderId: 1, operation: 'print', contentHash: 'old' }]) assert.throws(() => preparationInput(body));
  assert.deepEqual(preparationInput({ productionOrderId: 7, operation: 'start', resourceCode: ' ST7 ', requestedBy: 'spoof', force: true }),
    { productionOrderId: 7, operation: 'start', resourceCode: 'ST7' });
});
test('all preparation operations authorize before MES; lot assignment requires write', async () => {
  for (const operation of ['context', 'sheet', 'print', 'start']) {
    let authorization, sent;
    const body = { productionOrderId: 7, operation, resourceCode: 'ST7', contentHash: 'a'.repeat(64) };
    const deps = { authorize: async (req, write) => { authorization = write; return { scope: { mode: 'team' }, profile: { id: 'actual' }, canWrite: true }; },
      clientFactory: () => ({ preparationActions: async input => { sent = input; return { result: { ready: true } }; } }) };
    assert.equal((await handlePreparationActions({}, body, deps)).ready, true);
    assert.equal(authorization, operation !== 'context'); assert.equal(sent.requestedBy, 'actual'); assert.ok(sent.externalId);
    await assert.rejects(handlePreparationActions({}, body, { ...deps, authorize: async () => ({ scope: { mode: 'cliente', customer_code: '501.A' } }),
      clientFactory: () => { throw new Error('Must not call MES'); } }), { status: 403 });
  }
});
function mixingFixture({ areas = [], department = 'Miscelazione', denied = false, active = true } = {}) {
  const tables = { utenti: { attivo: active, reparto_id: 'mix', auth_user_id: 'auth' }, utenti_reparti: [],
    workspace_eccezioni_utente: denied ? [{ decisione: 'nega' }] : [], reparti: [{ nome: department, attivo: true }] };
  return { rpc: async () => ({ data: areas }), from(table) { const result = { data: tables[table] }; const q = {
    select: () => q, eq: () => q, in: () => q, maybeSingle: async () => result, then: resolve => Promise.resolve(result).then(resolve) }; return q; } };
}
test('mixing access follows active area/department membership and explicit denial', async () => {
  assert.equal(await mixingDepartmentAccess(mixingFixture(), 'user'), true);
  assert.equal(await mixingDepartmentAccess(mixingFixture({ department: 'Vendite', areas: ['miscelazione'] }), 'user'), true);
  for (const options of [{ department: 'Vendite' }, { department: 'Confezionamento' }, { denied: true }, { active: false }])
    assert.equal(await mixingDepartmentAccess(mixingFixture(options), 'user'), false);
});

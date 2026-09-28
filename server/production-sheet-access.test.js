import test from 'node:test';
import assert from 'node:assert/strict';
import { productionSheetSession } from './production-sheet-access.js';
const req = { headers: { authorization: 'Bearer user' } };
function fixture({ name = 'Addetto miscelazione', admin = false, active = true, customer = false, department = '', areas = [] } = {}) {
  return { auth: { getUser: async () => ({ data: { user: { id: 'auth' } } }) },
    rpc: async name => { assert.equal(name, 'workspace_area_access_codes'); return { data: areas }; },
    from(table) {
      const data = table === 'utenti' ? { id: 'user', attivo: active, reparto_id: department ? 'dept' : null, ruoli: { nome: name, amministratore_workspace: admin } }
        : table === 'reparti' ? [{ nome: department, attivo: true }]
        : table === 'workspace_customer_user_links' && customer ? [{ customer_code: 'C1' }] : [];
      const query = { select() { return this; }, eq() { return this; }, in() { return this; },
        maybeSingle: async () => ({ data }), then: resolve => Promise.resolve({ data }).then(resolve) };
      return query;
    } };
}
for (const [name, production, packaging] of [
  ['Addetto miscelazione', true, false], ['Addetto confezionamento', false, true],
  ['Produzione', true, true], ['Addetto produzione', true, true], ['Vendite', false, false],
]) test(`document matrix: ${name}`, async () => {
  for (const [kind, allowed] of [['production', production], ['packaging', packaging]]) {
    const promise = productionSheetSession(req, kind, { admin: fixture({ name }) });
    if (allowed) { const result = await promise; assert.equal(result.canPrint, true); assert.equal(result.canWrite, undefined); }
    else await assert.rejects(promise, { status: 403 });
  }
});
test('administrator bypasses missing legacy catalog entries', async () => {
  for (const kind of ['production', 'packaging']) assert.equal((await productionSheetSession(req, kind, { admin: fixture({ admin: true }) })).canPrint, true);
});
test('inactive and customer-linked users cannot print', async () => {
  for (const options of [{ active: false, admin: true }, { customer: true }, { name: 'Cliente', department: 'Produzione' }])
    await assert.rejects(productionSheetSession(req, 'production', { admin: fixture(options) }), { status: 403 });
});
test('department and area grants work independently from screen level', async () => {
  for (const options of [{ name: 'Operatore', department: 'Produzione' }, { name: 'Operatore', areas: ['produzione'] }])
    for (const kind of ['production', 'packaging']) assert.equal((await productionSheetSession(req, kind, { admin: fixture(options) })).canPrint, true);
});

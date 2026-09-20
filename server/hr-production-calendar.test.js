import test from 'node:test';
import assert from 'node:assert/strict';
import { productionDepartments, calendarRows, readProductionPlan, authorizeProductionCalendar, productionCalendarRequest } from './hr-production-calendar.js';

const calendar = { versions: [{ effectiveFrom: '2000-01-01', week: Object.fromEntries([1,2,3,4,5,6,7].map(d => [d, d < 6 ? [['08:00','16:00']] : []])) }], exceptions: [], closures: [] };
const row = { productionOrderId: 1, orderNumber: 'OP1', articleCode: 'MP1', articleDescription: 'Prodotto', operationType: 'Production', start: '2026-08-31T08:00:00', end: '2026-09-02T16:00:00', status: 'Pianificato', operatorNames: ['private'] };
test('reparti esatti, nessuna espansione automatica a tutti i reparti', () => {
  assert.deepEqual(productionDepartments(['Human Resources', 'Direzione']), []);
  assert.deepEqual(productionDepartments(['Miscelazione']), ['Production']);
  assert.deepEqual(productionDepartments(['AddettoConfezionamento']), ['Packaging', 'Cartoning']);
  assert.deepEqual(productionDepartments(['Produzione']), ['Production', 'Packaging', 'Cartoning']);
});
test('visibilità reparto, attraversamento mesi, dati ridotti e annullamenti', () => {
  const rows = calendarRows([row, { ...row, operationType: 'Packaging' }, { ...row, status: 'Annullato' }], ['Production'], '2026-09-01', '2026-09-30');
  assert.equal(rows.length, 1);
  assert.equal('operatorNames' in rows[0], false);
  assert.equal(calendarRows([row], ['Production'], '2026-10-01', '2026-10-31').length, 0);
});
test('tutte le pagine del piano, senza filtri upstream che perdono le sovrapposizioni', async () => {
  const queries = [];
  const rows = await readProductionPlan({ request: async (_, query) => { queries.push(query); return { total: 2, items: [{ ...row, productionOrderId: query.page }] }; } });
  assert.equal(rows.length, 2);
  assert.deepEqual(queries, [{ page: 1, pageSize: 500 }, { page: 2, pageSize: 500 }]);
});
function adminStub({ active = true, hr = true, workspaceAdmin = false, areas = [] } = {}) {
  const data = { utenti: { id: 'employee', attivo: active, reparto_id: workspaceAdmin ? null : 'mix', ruoli: { amministratore_workspace: workspaceAdmin } }, workspace_customer_user_links: [], workspace_hr_members: { active: hr }, utenti_reparti: [{ reparto_id: 'fill' }], reparti: [{ nome: 'Miscelazione', attivo: true }, { nome: 'Confezionamento', attivo: false }] };
  return { rpc: async () => ({ data: areas }), auth: { getUser: async () => ({ data: { user: { id: 'auth' } } }) }, from: table => {
    if (workspaceAdmin && !['utenti', 'workspace_customer_user_links'].includes(table)) throw new Error('Admin must not require HR membership or departments');
    const result = { data: data[table] };
    const query = { select: () => query, eq: () => query, in: async () => result, maybeSingle: async () => result, then: resolve => Promise.resolve(result).then(resolve) };
    return query;
  } };
}
test('autorizzazione verifica sessione, dipendente HR attivo e reparti attivi', async () => {
  const req = { headers: { authorization: 'Bearer test' } };
  assert.deepEqual(await authorizeProductionCalendar(req, adminStub()), ['Production']);
  assert.deepEqual(await authorizeProductionCalendar(req, adminStub({ hr: false })), []);
  assert.deepEqual(await authorizeProductionCalendar(req, adminStub({ hr: false, areas: ['miscelazione'] })), ['Production']);
  await assert.rejects(authorizeProductionCalendar(req, adminStub({ active: false })), { status: 403 });
  await assert.rejects(authorizeProductionCalendar({}, adminStub()), { status: 401 });
});
test('admin vede tutti i reparti anche senza HR; admin disattivato resta escluso', async () => {
  const req = { method: 'GET', headers: { authorization: 'Bearer test' }, query: { from: '2026-09-01', to: '2026-09-30' } };
  const operations = ['Production', 'Packaging', 'Cartoning'];
  const response = await productionCalendarRequest(req, {
    admin: adminStub({ workspaceAdmin: true, hr: false }),
    readCalendar: async () => calendar, readPlan: async () => ({ source: 'piano-attivo', items: operations.map(operationType => ({ ...row, operationType })) }),
  });
  assert.equal(response.enabled, true);
  assert.deepEqual(response.items.map(item => item.operationType), operations);
  assert.ok(response.items.every(item => !('operatorNames' in item)));
  await assert.rejects(authorizeProductionCalendar(req, adminStub({ workspaceAdmin: true, active: false })), { status: 403 });
});
test('nessuna chiamata MES per utenti non HR e parametri limitati', async () => {
  const req = { method: 'GET', query: { from: '2026-09-01', to: '2026-09-30' } };
  assert.deepEqual(await productionCalendarRequest(req, { admin: {}, authorize: async () => [] }), { enabled: false, items: [] });
  await assert.rejects(productionCalendarRequest({ ...req, query: { from: '2026-02-30', to: '2026-09-30' } }), { status: 400 });
});

test('authorization precedes plan retrieval and only department records leave the API', async () => {
  let calls = 0;
  const req = { method: 'GET', query: { from: '2026-09-01', to: '2026-09-30' } };
  const deps = { admin: {}, readCalendar: async () => calendar, readPlan: async () => { calls++; return { source: 'piano-attivo', items: [row, { ...row, operationType: 'Packaging' }] }; } };
  await assert.rejects(productionCalendarRequest(req, { ...deps, authorize: async () => { throw Object.assign(new Error('Denied'), { status: 403 }); } }), { status: 403 });
  assert.equal(calls, 0);
  const response = await productionCalendarRequest(req, { ...deps, authorize: async () => ['Production'] });
  assert.equal(response.items.length, 1);
  assert.equal(response.source, 'piano-attivo');
  assert.equal('operatorNames' in response.items[0], false);
});

test('cliente: stesso ambito Produzioni, esclusione altri ordini e pannelli Station', async () => {
  const req = { method: 'GET', query: { from: '2026-09-01', to: '2026-09-30' } };
  const orders = [{ id: 'own-oct' }];
  const response = await productionCalendarRequest(req, {
    admin: {}, authorize: async () => ({ operations: ['Production', 'Packaging'], orders }),
    readCalendar: async () => calendar, readPlan: async () => ({ items: [{ ...row, resource: 'ST7', resourceCode: 'ST7' }, { ...row, productionOrderId: 2 }] }),
    workbench: async options => {
      assert.equal(options.scopedOrders, orders);
      assert.equal(options.productionOrders.length, 2);
      return { items: [{ productionOrders: [{ id: 1 }] }] };
    },
  });
  assert.equal(response.items.length, 1);
  assert.equal(response.items[0].productionOrderId, 1);
  assert.equal('resourceCode' in response.items[0], false);
  assert.equal('resource' in response.items[0], false);
});

test('closed confirmed work is flagged instead of silently disappearing; other departments cannot cause warnings', async () => {
  const req = { method: 'GET', query: { from: '2026-09-18', to: '2026-09-21' } };
  const closed = { ...row, start: '2026-09-19T09:00', end: '2026-09-19T10:00',
    confirmedIntervals: [{ start: '2026-09-19T09:00', end: '2026-09-19T10:00' }] };
  const deps = { admin: {}, authorize: async () => ['Production'], readCalendar: async () => calendar,
    readPlan: async () => ({ items: [closed] }) };
  const result = await productionCalendarRequest(req, deps);
  assert.deepEqual(result.items, []);
  assert.match(result.warning, /ripianificare/);
  const scoped = await productionCalendarRequest(req, { ...deps,
    readPlan: async () => ({ items: [{ ...closed, operationType: 'Packaging' }] }) });
  assert.equal(scoped.warning, '');
});

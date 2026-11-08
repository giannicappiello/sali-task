import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrainCatalog } from './catalog.js';

const profile = { id: '11111111-1111-4111-8111-111111111111', ruoli: {} };
function authFor(scoped, modules = ['attivita']) {
  return { profile, scoped, capabilities: { internal_data: true, role_ai_level: 'analisi', allowed_modules: modules }, access: { modules, module_levels: {} } };
}
test('BUSINESS_SEARCH projects adds UI archive status without changing raw status or pagination', async () => {
  const projects = Array.from({ length: 51 }, (_, index) => ({ id: `p${index}`, stato: 'aperto' }));
  const scoped = { from(table) {
    const query = {
      select(columns, options) {
        if (table === 'v4_fasi_progetto') assert.deepEqual(options, { count: 'exact' });
        else assert.equal(table, 'v4_progetti');
        return this;
      },
      order() { return this; },
      in(column, ids) { assert.equal(column, 'progetto_id'); assert.equal(ids.length, 50); assert.equal(ids.includes('p50'), false); return this; },
      range(start, end) {
        if (table === 'v4_progetti') { assert.deepEqual([start, end], [0, 50]); return { data: projects }; }
        return { data: [{ id: 't', progetto_id: 'p0', stato: 'da_evadere', completato_at: '2026-11-02' }], count: 1 };
      },
    };
    return query;
  } };
  const tool = createBrainCatalog(authFor(scoped)).BUSINESS_SEARCH;
  const result = await tool.execute({ dataset: 'projects' });
  assert.equal(result.rows.length, 50);
  assert.equal(result.nextOffset, 50);
  assert.equal(result.rows[0].stato, 'aperto');
  assert.equal(result.rows[0].archiviato_secondo_criterio_ui, true);
  assert.equal(result.rows[1].archiviato_secondo_criterio_ui, false);
  assert.match(result.statusCoverage, /non un evento esplicito/);
  assert.equal(tool.effect, 'read');
});
test('task completion is projected and the module boundary is retained', async () => {
  const scoped = { from(table) {
    assert.equal(table, 'v4_fasi_progetto');
    return { select(columns) { assert(columns.split(',').includes('completato_at')); return this; }, order() { return this; }, range() { return { data: [{ stato: 'in_lavorazione', completato_at: '2026-11-02' }] }; } };
  } };
  const result = await createBrainCatalog(authFor(scoped)).BUSINESS_SEARCH.execute({ dataset: 'tasks' });
  assert.equal(result.rows[0].stato, 'in_lavorazione');
  assert.equal(result.rows[0].stato_archivio, 'chiuso');
  assert.equal(createBrainCatalog(authFor(scoped, [])).BUSINESS_SEARCH, undefined);
});
test('CRM results retain scope filtering and the unchanged response shape', async () => {
  let calls = 0;
  const rows = [{ id: 'account', nome: 'Synthetic account', tipo: 'b2b' }];
  const scoped = { from(table) {
    calls++;
    assert.equal(table, 'crm_accounts');
    return {
      select() { return this; }, order() { return this; }, range() { return this; },
      in(column, values) { assert.equal(column, 'tipo'); assert.deepEqual(values, ['b2b']); return this; },
      then(resolve) { resolve({ data: rows }); },
    };
  } };
  const result = await createBrainCatalog(authFor(scoped, ['crm_b2b'])).BUSINESS_SEARCH.execute({ dataset: 'crm_accounts' });
  assert.deepEqual(result.rows, rows);
  assert.equal(result.nextOffset, null);
  assert.equal(Object.hasOwn(result, 'statusCoverage'), false);
  assert.equal(calls, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { businessReadTools } from './business-reads.js';

test('raw order reads preserve the stored agent name and existing agent authorization', async () => {
  const auth = {
    profile: { ruoli: {} }, capabilities: { internal_data: true, allowed_modules: ['ordini_pr'] },
    access: { modules: ['ordini_pr'] },
    scoped: {
      from(table) {
        if (table === 'integrazioni_utenti') return { select: async () => ({ data: [{ modulo: 'gestione_ordini_pr', enabled: true, ruolo_ordini: 'agente' }] }) };
        assert.equal(table, 'ordini_testate');
        const query = {
          select() { return this; }, or() { return this; }, order() { return this; },
          in(column, values) { assert.equal(column, 'codice_agente_mexal'); assert.deepEqual(values, ['602.TEST']); return this; },
          range: async () => ({ data: [{ id: 'order', codice_agente_mexal: '602.TEST', agente_nome: 'Agente di prova', private_field: 'excluded' }] }),
        };
        return query;
      },
      rpc: async name => { assert.equal(name, 'visible_mexal_agent_codes'); return { data: ['602.TEST'] }; },
    },
  };
  const result = await businessReadTools(auth).WORKSPACE_ORDERS_SEARCH.execute({ module: 'prof' });
  assert.equal(result.rows[0].agente_nome, 'Agente di prova');
  assert.equal(result.rows[0].codice_agente_mexal, '602.TEST');
  assert.equal(Object.hasOwn(result.rows[0], 'private_field'), false);
  assert.equal(result.nextOffset, null);
});

test('raw order reads keep disabled integrations blocked', async () => {
  const auth = {
    profile: { ruoli: {} }, capabilities: { internal_data: true, allowed_modules: ['ordini_pr'] }, access: { modules: ['ordini_pr'] },
    scoped: { from: () => ({ select: async () => ({ data: [] }) }) },
  };
  await assert.rejects(businessReadTools(auth).WORKSPACE_ORDERS_SEARCH.execute({ module: 'prof' }), { status: 403 });
});

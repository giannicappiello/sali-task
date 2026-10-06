import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { syncWarehouseArticle } from './warehouse-article-sync.js';

const eventId = '00000000-0000-4000-8000-000000000001';
const snapshot = (code = 'CN0643') => ({ schemaVersion: 1, capturedAt: '2026-10-03T10:00:00Z',
  rows: [1, 8].map(warehouse => ({ article_code: code, warehouse_number: warehouse,
    unit_of_measure: 'PZ', on_hand: warehouse === 8 ? 32000 : 0, committed: 100, available: warehouse === 8 ? 31900 : -100, unit_cost: 1 })) });

test('uses the same queued MES snapshot and identity without touching other articles', async () => {
  const payload = JSON.stringify(snapshot());
  let sent;
  let applied;
  const db = { async rpc(name, args) { applied = { name, args }; return { error: null }; },
    from(table) { assert.equal(table,'workspace_warehouse_stock'); return {select(){return this;},eq(){return this;},async in(){return {data:snapshot().rows.map(x=>({...x,synchronized_at:snapshot().capturedAt})),error:null};}}; } };
  const mes = { async syncInventoryArticle(command) { sent = command; return { result: { eventId, payload } }; } };
  const result = await syncWarehouseArticle(db, { articleCode: ' cn0643 ', warehouseNumber: 8 }, { mes });
  assert.equal(sent.articleCode, 'CN0643');
  assert.equal(applied.name, 'apply_workspace_mes_inventory');
  assert.equal(applied.args.p_event_id, eventId);
  assert.equal(applied.args.p_hash, createHash('sha256').update(payload).digest('hex'));
  assert.deepEqual(applied.args.p_rows, snapshot().rows);
  assert.match(result.message, /Workspace e MES/);
});

test('rejects an unrelated article or incomplete warehouse snapshot before applying it', async () => {
  for (const value of [snapshot('CN9999'), { ...snapshot(), rows: snapshot().rows.slice(0, 1) }]) {
    const mes = { async syncInventoryArticle() { return { result: { eventId, payload: JSON.stringify(value) } }; } };
    await assert.rejects(syncWarehouseArticle({ rpc() { assert.fail('Unexpected write'); } },
      { articleCode: 'CN0643', warehouseNumber: 1 }, { mes }), /Snapshot giacenze MES non valido/);
  }
});

test('does not report success when shared delivery fails', async () => {
  const mes = { async syncInventoryArticle() { return { result: { eventId, payload: JSON.stringify(snapshot()) } }; } };
  await assert.rejects(syncWarehouseArticle({ async rpc() { return { error: new Error('Unavailable') }; } },
    { articleCode: 'CN0643', warehouseNumber: 8 }, { mes }), /ritentare automaticamente/);
});

test('validates the article and warehouse before calling MES or Mexal', async () => {
  for (const input of [{ articleCode: '', warehouseNumber: 8 }, { articleCode: 'CN0643', warehouseNumber: 0 },
    { articleCode: 'CN0643', warehouseNumber: 1.5 }]) {
    await assert.rejects(syncWarehouseArticle({}, input, { mes: {}, mexalFactory() { assert.fail('Unexpected Mexal call'); } }), /non valido/);
  }
});

test('a non-operational warehouse refresh preserves the other warehouse rows', async () => {
  const writes = [];
  const db = { from(table) { return {
    async upsert(rows) { writes.push({ table, rows }); return { error: null }; },
    select() { return { eq() { return this; }, async maybeSingle() { return { data: { warehouse_name: 'Commerciale' } }; } }; },
    update(values) { const filters = []; return { eq(key, value) { filters.push([key, value]); return this; },
      then(resolve) { writes.push({ table, values, filters }); return Promise.resolve({ error: null }).then(resolve); } }; },
  }; } };
  const mexalFactory = ({ warehouse }) => {
    assert.equal(warehouse, 5);
    return { async getJson() { return { dati: { codice: 'IT001', qta_inventario: 100, qta_carico: 10, qta_scarico: 5 } }; } };
  };
  await syncWarehouseArticle(db, { articleCode: 'IT001', warehouseNumber: 5 }, { mes: {}, mexalFactory });
  assert.equal(writes.length, 4);
  assert.equal(writes[0].rows[0].warehouse_number, 5);
  assert.equal(writes[0].rows[0].on_hand, 105);
  assert.equal(writes[0].rows[0].warehouse_name, 'Commerciale');
  assert.equal(writes[1].rows[0].warehouse_number, 5);
  assert.equal(writes[2].values.giacenza, 105);
  assert.deepEqual(writes[2].filters, [['codice_articolo', 'IT001']]);
  assert.equal(writes[3].values.giacenza, 105);
});

test('rejects success if Workspace keeps an old or mismatched quantity', async()=>{
 const mes={async syncInventoryArticle(){return {result:{eventId,payload:JSON.stringify(snapshot())}};}};
 for(const data of [[],snapshot().rows.map(x=>({...x,on_hand:1,synchronized_at:snapshot().capturedAt})),snapshot().rows.map(x=>({...x,synchronized_at:'2026-10-02T10:00:00Z'}))]) {
  const db={async rpc(){return {error:null};},from(){return {select(){return this;},eq(){return this;},async in(){return {data,error:null};}};}};
  await assert.rejects(syncWarehouseArticle(db,{articleCode:'CN0643',warehouseNumber:1},{mes}),/Sincronizzazione non confermata/);
 }
});

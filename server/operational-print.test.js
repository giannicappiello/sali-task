import test from 'node:test';
import assert from 'node:assert/strict';
import { operationalPrintId, requireCentralPrint } from './operational-print.js';
import { observeCentralPrint, pendingCentralPrint, finishCentralPrint } from '../src/pages/Dashboard/centralPrint.js';

test('reloads and retries retain the first print command until its terminal outcome', () => {
  const entries = new Map();
  const storage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
  const first = pendingCentralPrint('order:7', { hash: 'first' }, storage);
  assert.deepEqual(pendingCentralPrint('order:7', { hash: 'changed' }, storage), first);
  finishCentralPrint('order:7', storage);
  assert.notEqual(pendingCentralPrint('order:7', { hash: 'changed' }, storage).id, first.id);
});

test('legacy browser requests cannot submit a central print without a stable request ID', () => {
  for (const printRequestId of [null, '', 'x', '00000000-0000-0000-0000-000000000000'])
    assert.throws(() => operationalPrintId({ printRequestId }), { status: 400 });
  assert.equal(operationalPrintId({ printRequestId: '75F4FB07-8B4B-42DB-A5B4-CE3D9303ED11' }), '75f4fb07-8b4b-42db-a5b4-ce3d9303ed11');
});
test('legacy MES success cannot trigger local printing or be called central success', async () => {
  assert.throws(() => requireCentralPrint({ printed: true, sheet: {} }, 'print'), { status: 503 });
  await assert.rejects(observeCentralPrint(async () => ({ printed: true }), () => {}), /Aggiornare ProgreMES/);
});
test('central terminal outcomes preserve errors and confirmation result', async () => {
  for (const status of ['Completed', 'Failed']) {
    const job = { id: 'job', printer: 'Production', status, confirmedAt: status === 'Completed' ? 'now' : null, error: status === 'Failed' ? 'offline' : null };
    let displayed;
    assert.deepEqual(await observeCentralPrint(async () => ({ printJob: job }), value => { displayed = value; }), job);
    assert.deepEqual(displayed, job);
  }
});

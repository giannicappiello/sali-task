import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePackagingSheet } from './packaging-sheet.js';
const session = { scope: { mode: 'tutti' }, profile: { id: 7 }, canWrite: true };
test('packaging sheet validates identity and requires write permission only for printing', async () => {
  for (const operation of ['read', 'print']) {
    const calls = [];
    const result = await handlePackagingSheet({}, { productionOrderId: 42, operation }, {
      authorize: async (...args) => { calls.push(args); return session; },
      clientFactory: () => ({ packagingSheet: async payload => { assert.equal(payload.productionOrderId, 42); assert.equal(payload.operation, operation); assert.equal(payload.requestedBy, '7'); return { result: { sheet: { numeroOrdine: 'OP42' } } }; } }),
    });
    assert.equal(calls[0][1], 'progremes.Produzione'); assert.equal(calls[0][2], operation === 'print'); assert.equal(result.canPrint, true);
  }
});
test('invalid requests and customer scopes cannot reach MES', async () => {
  const dependencies = { authorize: async () => ({ ...session, scope: { mode: 'cliente' } }), clientFactory: () => { throw new Error('must not reach MES'); } };
  await assert.rejects(handlePackagingSheet({}, { productionOrderId: 42 }, dependencies), { status: 403 });
  for (const productionOrderId of [0, -1, 1.5, '../42', 2147483648]) await assert.rejects(handlePackagingSheet({}, { productionOrderId }, dependencies), { status: 400 });
  await assert.rejects(handlePackagingSheet({}, { productionOrderId: 42, operation: 'delete' }, dependencies), { status: 400 });
});
test('old MES reports update required and release blocks remain visible', async () => {
  for (const status of [404, 409]) {
    await assert.rejects(handlePackagingSheet({}, { productionOrderId: 42 }, {
      authorize: async () => session, clientFactory: () => ({ packagingSheet: async () => { throw Object.assign(new Error('ODL non rilasciato'), { status }); } }),
    }), error => error.status === (status === 404 ? 503 : 409) && error.message.includes(status === 404 ? 'aggiornamento' : 'ODL'));
  }
});

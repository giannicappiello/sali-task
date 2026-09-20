import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePackagingActions, packagingActionInput } from './packaging-actions.js';
import { piecesInBox } from '../src/pages/Dashboard/thermalLabelModel.js';
const session = { scope: { mode: 'tutti' }, profile: { id: 7 }, canWrite: true };
test('thermal labels preserve partial final box and blank quantities', () => {
  assert.equal(piecesInBox(25, 12, 1), 12); assert.equal(piecesInBox(25, 12, 3), 1);
  assert.equal(piecesInBox(25, 12, 4), 0); assert.equal(piecesInBox(25, 0, 1), null);
});
test('labels and start validate all supplied quantities, phase IDs and resource', () => {
  for (const labelCount of [0, 1001, 1.5, 'bad']) assert.throws(() => packagingActionInput({ productionOrderId: 42, operation: 'thermal-print', labelCount, piecesPerBox: 12 }));
  for (const piecesPerBox of [-1, 'bad', Infinity]) assert.throws(() => packagingActionInput({ productionOrderId: 42, operation: 'thermal-print', labelCount: 1, piecesPerBox }));
  assert.throws(() => packagingActionInput({ productionOrderId: 42, operation: 'start', resourceCode: 'F03', productionId: -1 }));
  assert.throws(() => packagingActionInput({ productionOrderId: 42, operation: 'start-context', resourceCode: '' }));
  assert.throws(() => packagingActionInput({ productionOrderId: 42, operation: 'start-force' }));
  assert.deepEqual(packagingActionInput({ productionOrderId: 42, operation: 'thermal-read', productionId: 99, requestedBy: 'forged' }), { productionOrderId: 42, operation: 'thermal-read' });
});
test('print and start require write access and propagate the exact selected phase and line', async () => {
  for (const operation of ['thermal-read', 'thermal-print', 'start-context', 'start']) {
    const calls = [];
    await handlePackagingActions({}, { productionOrderId: 42, operation, resourceCode: 'F03', productionId: 81, labelCount: 3, piecesPerBox: 12, requestedBy: 'forged' }, {
      authorize: async (...args) => { calls.push(args); return session; },
      clientFactory: () => ({ packagingActions: async input => {
        assert.equal(input.requestedBy, '7'); assert.equal(input.productionOrderId, 42);
        if (operation === 'start') { assert.equal(input.productionId, 81); assert.equal(input.resourceCode, 'F03'); }
        return { result: { started: true } };
      } }),
    });
    assert.equal(calls[0][1], 'progremes.Produzione'); assert.equal(calls[0][2], ['start', 'thermal-print'].includes(operation));
  }
});
test('denied users and customer scopes never invoke a production action', async () => {
  let invoked = false;
  const clientFactory = () => { invoked = true; throw new Error('unexpected'); };
  for (const scope of [{ mode: 'cliente' }, { mode: 'tutti', customer_codes: ['C1'] }])
    await assert.rejects(handlePackagingActions({}, { productionOrderId: 42, operation: 'thermal-read' }, { authorize: async () => ({ ...session, scope }), clientFactory }), { status: 403 });
  await assert.rejects(handlePackagingActions({}, { productionOrderId: 42, operation: 'start', resourceCode: 'F03', productionId: 81 }, { authorize: async () => { throw Object.assign(new Error('Denied'), { status: 403 }); }, clientFactory }), { status: 403 });
  assert.equal(invoked, false);
});
test('MES business blocks are returned without automatic retries', async () => {
  let calls = 0;
  await assert.rejects(handlePackagingActions({}, { productionOrderId: 42, operation: 'start', resourceCode: 'F03', productionId: 81 }, {
    authorize: async () => session, clientFactory: () => ({ packagingActions: async () => { calls++; throw Object.assign(new Error('ODL non rilasciato'), { status: 409 }); } }),
  }), { message: 'ODL non rilasciato', status: 409 });
  assert.equal(calls, 1);
});

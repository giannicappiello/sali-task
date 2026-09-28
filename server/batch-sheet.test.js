import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBatchSheet } from './batch-sheet.js';
const phaseId = '11111111-1111-1111-1111-111111111111';
test('batch requests check department every time and preserve the selected phase and hash', async () => {
  for (const kind of ['production', 'packaging']) for (const operation of ['list', 'sheet', 'print', 'start']) {
    let sent;
    const result = await handleBatchSheet({}, { productionOrderId: 42, kind, operation, phaseId, contentHash: 'a'.repeat(64), requestedBy:'forged', allowShortage:true }, {
      authorize: async (_, actualKind) => { assert.equal(actualKind, kind); return { profile:{id:'operator'}, scope:{mode:'team'} }; },
      clientFactory: () => ({ batchSheet:async payload => { sent = payload; return {result:{managed:true}}; } }),
    });
    assert.equal(sent.phaseId, phaseId); assert.equal(sent.requestedBy, 'operator');
    assert.equal(sent.allowShortage, undefined); assert.equal(result.canStart, true);
  }
});
test('invalid phase/hash and customer scopes never reach MES', async () => {
  const dependencies = {authorize: async () => ({profile:{id:'customer'},scope:{mode:'team',customer_code:'X'}}),clientFactory:()=>{throw new Error('must not call MES');}};
  for (const body of [{kind:'other'}, {operation:'delete'}, {operation:'sheet',phaseId:'bad'}, {operation:'start',phaseId,contentHash:'bad'}])
    await assert.rejects(handleBatchSheet({}, {productionOrderId:42,kind:'production',operation:'list',...body}, dependencies),{status:400});
  await assert.rejects(handleBatchSheet({}, {productionOrderId:42,kind:'production',operation:'list'}, dependencies),{status:403});
});

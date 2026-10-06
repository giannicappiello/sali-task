import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBatchSheet } from './batch-sheet.js';
const phaseId = '11111111-1111-1111-1111-111111111111';
test('batch requests check department every time and preserve the selected phase and hash', async () => {
  for (const kind of ['production', 'packaging']) for (const operation of ['list', 'sheet', 'print', 'start']) {
    let sent;
    const result = await handleBatchSheet({}, { productionOrderId: 42, kind, operation, phaseId, contentHash: 'a'.repeat(64), printRequestId: '75f4fb07-8b4b-42db-a5b4-ce3d9303ed11', requestedBy:'forged', allowShortage:true }, {
      authorize: async (_, actualKind) => { assert.equal(actualKind, kind); return { profile:{id:'operator'}, scope:{mode:'team'} }; },
      clientFactory: () => ({ batchSheet:async payload => { sent = payload; return {result:{managed:true, printJob:{id:'job',printer:'PRODUZIONE',status:'Queued'}}}; } }),
    });
    assert.equal(sent.phaseId, phaseId); assert.equal(sent.requestedBy, 'operator');
    if (operation === 'print') { assert.equal(sent.externalId, '75f4fb07-8b4b-42db-a5b4-ce3d9303ed11'); assert.equal(sent.printMode, 'server'); }
    assert.equal(sent.allowShortage, ['start','print'].includes(operation) && kind === 'production'); assert.equal(result.canStart, true);
  }
});
test('invalid phase/hash and customer scopes never reach MES', async () => {
  const dependencies = {authorize: async () => ({profile:{id:'customer'},scope:{mode:'team',customer_code:'X'}}),clientFactory:()=>{throw new Error('must not call MES');}};
  for (const body of [{kind:'other'}, {operation:'delete'}, {operation:'sheet',phaseId:'bad'}, {operation:'start',phaseId,contentHash:'bad'}])
    await assert.rejects(handleBatchSheet({}, {productionOrderId:42,kind:'production',operation:'list',...body}, dependencies),{status:400});
  await assert.rejects(handleBatchSheet({}, {productionOrderId:42,kind:'production',operation:'list'}, dependencies),{status:403});
});

test('batch printing rejects old clients and legacy MES acknowledgments', async () => {
  const body = { productionOrderId: 42, kind: 'production', operation: 'print', phaseId, contentHash: 'a'.repeat(64) };
  const deps = { authorize: async () => ({ profile: { id: 'operator' }, scope: { mode: 'team' } }), clientFactory: () => ({ batchSheet: async () => ({ result: { printed: true } }) }) };
  await assert.rejects(handleBatchSheet({}, body, deps), { status: 400 });
  await assert.rejects(handleBatchSheet({}, { ...body, printRequestId: '75f4fb07-8b4b-42db-a5b4-ce3d9303ed11' }, deps), { status: 503 });
});

test('packaging completion preserves actuals and enforces department and kind', async () => {
 const actual = {operator:'Mario', responsible:'Anna', produced:1200, scrap:3};
 let sent;
 const deps={authorize:async()=>({profile:{id:'admin'},scope:{mode:'team'}}),clientFactory:()=>({batchSheet:async payload=>{sent=payload;return {result:{closed:true}};}})};
 const body={productionOrderId:42,kind:'packaging',operation:'complete-sheet',phaseId,contentHash:'a'.repeat(64),actual};
 assert.equal((await handleBatchSheet({},body,deps)).closed,true);
 assert.deepEqual(sent.actual,actual); assert.equal(sent.requestedBy,'admin');
 await assert.rejects(handleBatchSheet({},{...body,kind:'production'},deps),{status:400});
 await assert.rejects(handleBatchSheet({},{...body,contentHash:''},deps),{status:400});
 await assert.rejects(handleBatchSheet({},body,{...deps,authorize:async()=>({profile:{id:'customer'},scope:{customer_code:'X'}})}),{status:403});
});

test('saved sheet and archive status can be read without a stale sheet hash', async () => {
 for (const operation of ['actual-sheet','archive-status']) {
  let called=false;
  const result=await handleBatchSheet({}, {productionOrderId:42,kind:'packaging',operation,phaseId}, {
   authorize:async()=>({profile:{id:'admin'},scope:{mode:'team'}}),
   clientFactory:()=>({batchSheet:async()=>{called=true;return {result:{saved:null}};}})
  });
  assert.equal(called,true); assert.equal(result.saved,null);
 }
});

test('print and start intent is authorized and persisted with the same operator and shortage choice',async()=>{
 let sent;
 await handleBatchSheet({}, {productionOrderId:42,kind:'production',operation:'print',phaseId,contentHash:'a'.repeat(64),printRequestId:'75f4fb07-8b4b-42db-a5b4-ce3d9303ed11',startAfterPrint:true,allowShortage:false}, {
 authorize:async()=>({profile:{id:'maria'},scope:{mode:'team'}}),clientFactory:()=>({batchSheet:async payload=>{sent=payload;return {result:{printJob:{id:'job',printer:'PRODUZIONE',status:'Queued'}}};}})
 });
 assert.equal(sent.startAfterPrint,true);assert.equal(sent.requestedBy,'maria');assert.equal(sent.allowShortage,false);
});

import test from 'node:test';
import {setImmediate} from 'node:timers';
import assert from 'node:assert/strict';
import {loadWorkspaceWarehouse} from '../src/pages/Warehouse/warehouseData.js';
function fixture(results) {
  const calls=[];
  const db={rpc(name,args){const call={name,args};calls.push(call);const response=Promise.resolve(results[calls.length-1]);response.abortSignal=signal=>{call.signal=signal;return response;};return response;}};
  return {db,calls};
}
test('SQL timeout retries once with identical role-scoped request filters',async()=>{
  const f=fixture([{error:{code:'57014',message:'statement timeout'},status:500},{data:{rows:['CN0643']},status:200}]);
  const filters={asOfDate:'2026-10-06',warehouse:'MAG-8',type:'CN',unit:'PZ',query:'CN0643',stockFilter:'positive',page:2,pageSize:100};
  const result=await loadWorkspaceWarehouse(f.db,filters);
  assert.deepEqual(result,{rows:['CN0643']}); assert.equal(f.calls.length,2);
  assert.deepEqual(f.calls[0].args,f.calls[1].args); assert.equal(f.calls[1].args.p_offset,100);
});
test('permanent permission failure never retries',async()=>{
  const error={code:'42501',message:'permission denied'};const f=fixture([{error,status:403}]);
  await assert.rejects(loadWorkspaceWarehouse(f.db),e=>e===error);assert.equal(f.calls.length,1);
});
test('second transient failure terminates and allows a new explicit load',async()=>{
  const error={code:'57014'};const f=fixture([{error,status:500},{error,status:500},{data:{rows:['new']},status:200}]);
  await assert.rejects(loadWorkspaceWarehouse(f.db),e=>e===error);assert.equal(f.calls.length,2);
  assert.deepEqual(await loadWorkspaceWarehouse(f.db),{rows:['new']});
});
test('changing filters or leaving page cancels the retry before another SQL call',async()=>{
  const f=fixture([{error:{code:'57014'},status:500}]);const controller=new AbortController();
  const pending=loadWorkspaceWarehouse(f.db,{}, {signal:controller.signal});
  await new Promise(resolve=>setImmediate(resolve));controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(f.calls.length,1);
});
test('already aborted request makes no call',async()=>{
  const f=fixture([]);const controller=new AbortController();controller.abort();
  await assert.rejects(loadWorkspaceWarehouse(f.db,{}, {signal:controller.signal}),{name:'AbortError'});assert.equal(f.calls.length,0);
});


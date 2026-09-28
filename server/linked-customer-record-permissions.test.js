import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPrivateCustomerDetailAccess, customerOrderOverview, loadCustomerInvoiceReferences } from './private-orders-workbench.js';
import { isCustomerRecordScope } from '../src/lib/customerRecordAccess.js';
import { verifyUser } from './mexal/sync-products.js';

test('service-role order writers reject linked customers before mutation, including admin roles', async () => {
  function client(linked, admin) {
    return {auth:{getUser:async()=>({data:{user:{id:'AUTH'}}})},rpc:async()=>({data:true}),
      from(table){const data=table==='utenti'?[{id:'U',attivo:true,ruoli:{amministratore_workspace:admin}}]:linked?[{customer_code:'A'},{customer_code:'B'}]:[];
        return {select(){return this},eq(){return this},limit(){return this},then(resolve){return Promise.resolve({data}).then(resolve)}};
      }};
  }
  const req={headers:{authorization:'Bearer fixture'}};
  for(const admin of [true,false]) await assert.rejects(verifyUser(req,client(true,admin),{allowOrdersUser:true,allowCustomerPrivateOrder:true}),{status:403});
  assert.equal((await verifyUser(req,client(false,true),{allowOrdersUser:true,allowCustomerPrivateOrder:true})).isAdmin,true);
});

test('linked customer scope takes precedence over operative role/global mode', () => {
  for (const scope of [{mode:'cliente'}, {mode:'tutti',customerCodes:['A','B']}, {customerCode:'A'}]) assert.equal(isCustomerRecordScope(scope),true);
  for (const scope of [null,{mode:'tutti'}, {mode:'team',customerCodes:[]}]) assert.equal(isCustomerRecordScope(scope),false);
});

test('customer detail is denied even for own orders; internal users retain access', () => {
  assert.throws(()=>assertPrivateCustomerDetailAccess(['A']), {status:403});
  assert.throws(()=>assertPrivateCustomerDetailAccess(['A','B']), {status:403});
  assert.doesNotThrow(()=>assertPrivateCustomerDetailAccess([]));
});

test('overview projects only authorized display fields and invoice references', () => {
  const row={id:'A',label:'OC/1/23',customer:'Customer A',plannedCompletionDate:'2026-10-01',requestId:'SECRET',rdpNumber:12,diagnostics:[{secret:true}],productionOrders:[{id:1}],lines:[{id:'L',articleCode:'FP',description:'Product',orderedQuantity:100,fulfilledQuantity:20,unit:'PZ',internalCost:99,productionStatus:'SECRET'}]};
  const links=[{ordine_id:'A',invoice:{sigla:'FT',serie:1,numero:77,articles:'SECRET'}},{ordine_id:'B',invoice:{sigla:'FT',serie:1,numero:88}}];
  const actual=customerOrderOverview(row,links);
  assert.deepEqual(actual.invoiceReferences,['FT/1/77']);
  assert.equal(actual.lines[0].orderedQuantity,100);
  assert.equal(actual.lines[0].fulfilledQuantity,20);
  assert.doesNotMatch(JSON.stringify(actual),/SECRET|rdpNumber|requestId|internalCost|productionOrders|diagnostics|88/);
  assert.equal(customerOrderOverview(row,[],true).invoiceLookupError,true);
});

test('invoice lookup is paginated, scoped and distinguishes failure from no invoice', async () => {
  const calls=[];
  const caller={rpc:async(name,params)=>{calls.push({name,params});return {data:[],error:null}}};
  const orders=Array.from({length:205},(_,id)=>({id:String(id)}));
  assert.deepEqual(await loadCustomerInvoiceReferences(caller,orders),{links:[],error:false});
  assert.deepEqual(calls.map(c=>c.params.p_order_ids.length),[100,100,5]);
  assert.deepEqual(calls.flatMap(c=>c.params.p_order_ids),orders.map(o=>o.id));
  assert.deepEqual(await loadCustomerInvoiceReferences({rpc:async()=>({error:{message:'unavailable'}})},orders),{links:[],error:true});
});

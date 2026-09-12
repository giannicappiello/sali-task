import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CUSTOMER_PRODUCT_SCREENS, groupCustomerProducts, productAmount, productQuantities, previousProductPeriod, loadCustomerProductLines, loadProductCustomers } from '../../src/modules/crm/customerProducts.js';
import { CRM_ROUTE_CATALOG } from '../../src/modules/crm/crmRouteCatalog.js';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const row = (id, date, extra = {}) => ({ line_id: id, document_id: 'doc-' + id, document_date: date, product_code: 'IT001', description: 'Crema completa', quantity: 2, unit: 'PZ', net_amount: 10, line_position: 1, ...extra });
const period = { from: '2026-08-01', to: '2026-08-31' };

test('all documents and lines retained, duplicate transport lines counted once', () => {
 const first = row('1','2026-08-01');
 const product = groupCustomerProducts([first, first, row('2','2026-08-01',{document_id:'doc-1'}),row('3','2026-08-10')],period)[0];
 assert.equal(product.lines.length,3);assert.equal(product.documents,2);assert.equal(product.amount.value,30);
 assert.equal(product.reorders,1);assert.equal(product.frequency,9);
});
test('reorder uses full history before period, not first document in filtered list', () => {
 const product=groupCustomerProducts([row('1','2026-07-01'),row('2','2026-08-01'),row('3','2026-08-15')],period)[0];
 assert.equal(product.history.length,3);assert.equal(product.lines.length,2);assert.equal(product.reorders,2);
 assert.equal(groupCustomerProducts([row('1','2025-01-01')],period).length,0);
 assert.equal(groupCustomerProducts([row('1','2025-01-01')],{...period,allHistory:true}).length,1);
});
test('credits are signed, canceled retained in history but excluded from totals, units separate', () => {
 const rows=[row('1','2026-08-01'),row('2','2026-08-04',{net_amount:-5,quantity:-1,is_credit:true}),row('3','2026-08-10',{net_amount:500,excluded_from_totals:true}),row('4','2026-08-12',{unit:'KG',quantity:0.5})];
 const product=groupCustomerProducts(rows,period)[0];
 assert.equal(product.amount.value,15);assert.equal(product.history.length,4);assert.equal(product.reorders,1);
 assert.deepEqual(productQuantities(rows),[{unit:'PZ',quantity:1},{unit:'KG',quantity:0.5}]);
});
test('unknown net values do not become invented gross amounts or NaN', () => {
 assert.deepEqual(productAmount([{net_amount:3.2},{net_amount:null},{net_amount:'bad'}]),{value:3.2,unknown:2});
 const product=groupCustomerProducts([row('1','2026-08-01',{net_amount:null})],period)[0];
 assert.equal(product.share,null);assert.equal(product.variation,null);
});
test('previous comparison is equal-length and ranges are inclusive', () => {
 assert.deepEqual(previousProductPeriod('2026-08-01','2026-08-31'),{from:'2026-07-01',to:'2026-07-31'});
 const product=groupCustomerProducts([row('1','2026-07-01'),row('2','2026-08-01'),row('3','2026-08-31'),row('4','2026-09-01')],period)[0];
 assert.equal(product.variation,100);assert.equal(product.amount.value,20);
});
test('pagination and DIRECT context forwarded to same RPC, errors propagated', async () => {
 const calls=[];const signal=new AbortController().signal;
 const client={rpc(name,args){return{range(from,to){return{async abortSignal(s){calls.push({name,args,from,to,s});return{data:Array.from({length:from===0?500:1},(_,i)=>({id:from+i}))};}};}};}};
 assert.equal((await loadCustomerProductLines(client,'mexal:ONLINE','ordered',signal,'online')).length,501);
 assert.deepEqual(calls[0].args,{p_customer_key:'mexal:ONLINE',p_kind:'ordered',p_crm_type:'online'});
 assert.equal(calls[1].from,500);assert.equal(calls[1].s,signal);
 const failed={rpc(){return{range(){return{abortSignal:async()=>({error:new Error('denied')})};}};}};
 await assert.rejects(loadCustomerProductLines(failed,'mexal:A','purchased',signal),/denied/);
});
test('customer selector filters canonical DIRECT contexts without narrowing authorization itself',async()=>{
 const scopes=[];const client={from(){const q={select:()=>q,in:(key,values)=>{scopes.push([key,values]);return q;},order:()=>q,range:()=>q,abortSignal:async()=>({data:[{codice_cliente:'A',ragione_sociale:'Cliente A',area_crm:'online'}]})};return q;}};
 assert.equal((await loadProductCustomers(client,undefined,'online'))[0].crmType,'online');
 await loadProductCustomers(client);assert.deepEqual(scopes,[['area_crm',['online']],['area_crm',['b2b','online']]]);
});
test('exactly two reusable catalogued screens without hardcoded module dependencies',()=>{
 const routes=CRM_ROUTE_CATALOG.filter(route=>route.view==='customer-products');assert.equal(routes.length,2);
 for(const [kind,screen] of Object.entries(CUSTOMER_PRODUCT_SCREENS)){const route=routes.find(route=>route.kind===kind);assert.equal(route.catalogPath,screen.path);assert.equal(route.screenCode,screen.code);assert.equal(route.moduleCode,undefined);}
 const cards=read('src/modules/crm/CustomerProductCards.jsx');assert.match(cards,/customer: customerKey, crmType/);
 assert.match(read('src/modules/crm/CrmModule.jsx'),/\["b2b", "online"\]\.includes\(type\) \? <CustomerProductCards/);
});
test('migration does not grant area/module access or bypass existing row policies',()=>{
 const sql=read('supabase/migrations/20260913010000_crm_customer_product_screens.sql');
 assert.match(sql,/security invoker/);assert.doesNotMatch(sql,/security definer/i);
 assert.match(sql,/c.area_crm in \('b2b','online'\)/);assert.match(sql,/p_crm_type is null or c.area_crm=p_crm_type/);
 assert.match(sql,/crm_order_kpi_source/);assert.match(sql,/l.imponibile_riga net_amount/);assert.match(sql,/l.valore_netto/);
 assert.doesNotMatch(sql,/insert into public.workspace_moduli|insert into public.workspace_aree|update public.utenti|crm_has_module_level/i);
 assert.match(sql,/false,true,36,null,'\{\}'/);assert.match(sql,/false,true,37,null,'\{\}'/);
 assert.match(sql,/on conflict\(codice\) do update set percorso=excluded.percorso,chiave_componente=excluded.chiave_componente/);
});
test('popup contains all document lines and closing preserves router page, filters and focus',()=>{
 const source=read('src/modules/crm/CustomerProductsPage.jsx');
 assert.match(source,/rows.filter\(row => row.document_id === documentId\)/);
 assert.match(source,/displayed.map\(line/);assert.match(source,/previousFocus\?\.focus/);assert.match(source,/onClose=\{\(\) => update\('product', ''\)\}/);
 assert.match(source,/replace: true/);assert.doesNotMatch(source,/window\.location|window\.open|slice\(0, 50\)/);
});

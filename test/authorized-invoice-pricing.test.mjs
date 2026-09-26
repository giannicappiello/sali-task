import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveOctRevenue} from '../src/features/production-costs/commercial-revenue.js';
const e={id:1,orderNumber:'OC/2/196',articleCode:'A',customerCode:'C',quantity:900,unit:'KG'};
const pricing={authorized:true,productionId:1,reference:'OC+2+196',articleCode:'A',customerCode:'C',quantity:900,unit:'KG',unitPrice:1.29,invoiceReference:'FT 1/10'};
test('authorized OC uses invoice unit price on production quantity, independently of invoice revenue',()=>{
 const r=resolveOctRevenue({...e,authorizedInvoicePricing:pricing,invoiceRevenue:2000},[],[e]);
 assert.equal(r.octRevenue,1161);assert.equal(r.octPartial,false);assert.match(r.octReasons[0],/FT 1\/10/);
});
test('invoice pricing cannot spread to another production or changed identity or quantity',()=>{
 for(const change of [{id:2},{quantity:1000},{unit:'PZ'},{customerCode:'D'},{articleCode:'B'},{orderNumber:'OC/2/197'}]){
  assert.equal(resolveOctRevenue({...e,...change,authorizedInvoicePricing:pricing},[],[]).octRevenue,null);
 }
 assert.equal(resolveOctRevenue(e,[],[]).octRevenue,null);
 assert.equal(resolveOctRevenue({...e,authorizedInvoicePricing:{...pricing,authorized:false}},[],[]).octRevenue,null);
});

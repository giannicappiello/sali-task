import test from 'node:test';
import assert from 'node:assert/strict';
import { amazonProductsPreview, orderDisplayAmount } from '../../shared/amazonOrderAmounts.js';
import { salesDays } from '../../src/modules/crm/digitalSalesDayModel.js';
import { reconcileDigitalLines, productAsinRows } from '../../src/modules/crm/digitalProductReconciliation.js';
import { digitalChannelKpis } from '../../src/modules/crm/digitalChannelKpiModel.js';

test('available product prices are provisional and never replace confirmed net amounts', () => {
  const preview=amazonProductsPreview([{quantity:2,unit_price:14.7,line_revenue:null}],'EUR');
  assert.equal(preview.amount,29.4);
  assert.deepEqual(orderDisplayAmount({net_revenue:12.11,gross_revenue:14.78,pricePreview:preview}),{amount:12.11,note:'',basis:'net'});
  assert.equal(orderDisplayAmount({gross_revenue:14.78}).basis,'gross');
  assert.equal(orderDisplayAmount({pricePreview:preview}).basis,'products');
  assert.equal(orderDisplayAmount({pricePreview:preview}).amount,29.4);
  assert.equal(amazonProductsPreview([{quantity:1,unit_price:null}]),null);
  assert.equal(amazonProductsPreview([{quantity:1,unit_price:20},{quantity:null,unit_price:10}]),null);
  assert.equal(amazonProductsPreview([{quantity:1,unit_price:20,line_revenue:0}]).amount,0);
});
test('daily fulfilled and waiting counts exclude cancelled orders and do not combine pending prices with fulfilled net totals', () => {
  const orders=['SHIPPED','UNSHIPPED','PARTIALLY_SHIPPED','PENDING','PENDING_AVAILABILITY','CANCELLED','UNFULFILLABLE'].map((stato,index)=>({id:String(index),stato,ordered_at:'2026-10-19',currency:'EUR',net_revenue:index===0?12.26:null}));
  const [day]=salesDays(orders);
  assert.equal(day.fulfilledCount,1); assert.equal(day.waitingCount,4); assert.equal(day.fulfilledAmount,12.26);
  const [pending]=salesDays(orders.filter(row=>row.stato==='PENDING'));
  assert.equal(pending.fulfilledAmount,0); assert.equal(pending.waitingCount,1);
});
test('reconciliation unifies distinct ASINs under one product and keeps exact ASIN quantities and amounts', () => {
  const orders=[{id:'o1',connection_id:'c',marketplace:'IT',stato:'SHIPPED',currency:'EUR'},{id:'o2',connection_id:'c',marketplace:'IT',stato:'SHIPPED',currency:'EUR'}];
  const lines=[{id:'l1',order_id:'o1',external_sku:'sku1',asin:'ASIN1',quantity:2,line_revenue:20},{id:'l2',order_id:'o2',external_sku:'sku2',asin:'ASIN2',quantity:3,line_revenue:30}];
  const mappings=['sku1','sku2'].map(external_sku=>({connection_id:'c',marketplace:'IT',external_sku,product_id:'product',codice_mexal:'IT001',status:'matched',prodotti:{nome:'Crema'}}));
  const reconciled=reconcileDigitalLines(orders,lines,mappings);
  const model=digitalChannelKpis(orders,reconciled);
  assert.equal(model.products.length,1); assert.equal(model.products[0].name,'Crema'); assert.equal(model.products[0].code,'IT001');
  assert.equal(model.products[0].quantity,5); assert.equal(model.products[0].count,2);
  assert.equal(model.products[0].amounts.totals[0].amount,50);
  const variants=productAsinRows(model.products[0]);
  assert.deepEqual(variants.map(row=>[row.asin,row.quantity]),[['ASIN1',2],['ASIN2',3]]);
  assert.equal(lines[0].product_id,undefined);
  assert.equal(reconcileDigitalLines(orders,lines,mappings.map(row=>({...row,connection_id:'other'})))[0].product_id,undefined);
  assert.equal(reconcileDigitalLines(orders,lines,mappings.map(row=>({...row,marketplace:'FR'})))[0].product_id,undefined);
});


test('imported product actions use the exact connection, marketplace and SKU mapping', async () => {
  const {importedProductsWithMappings}=await import('../../src/modules/crm/digitalProductReconciliation.js');
  const products=[{id:'p',connection_id:'c',marketplace:'IT',external_sku:'sku',asin:'A'},{id:'f',connection_id:'c',marketplace:'FR',external_sku:'sku',asin:'A'}];
  const mapping={id:'m',connection_id:'c',marketplace:'IT',external_sku:'sku',product_id:'canonical',status:'matched'};
  const rows=importedProductsWithMappings(products,[mapping]);
  assert.equal(rows[0].mapping.id,'m'); assert.equal(rows[0].mapping.product_id,'canonical');
  assert.equal(rows[1].mapping.id,undefined); assert.equal(rows[1].mapping.marketplace,'FR'); assert.equal(rows[1].mapping.asin,'A');
  assert.equal(products[0].mapping,undefined);
});

test('website imported duplicates share their SKU reconciliation without affecting another store or Amazon',async()=>{
 const {importedProductsWithMappings}=await import('../../src/modules/crm/digitalProductReconciliation.js');
 const products=[
  {id:'en',connection_id:'woo',marketplace:'website',external_sku:'IT0198'},
  {id:'it',connection_id:'woo',marketplace:'website',external_sku:'IT0198'},
  {id:'amazon',connection_id:'amazon',marketplace:'IT',external_sku:'IT0198'},
  {id:'other',connection_id:'other-store',marketplace:'website',external_sku:'IT0198'},
 ];
 const mapping={id:'m',connection_id:'woo',marketplace:'website',external_sku:'IT0198',product_id:'canonical',codice_mexal:'IT0198',status:'matched'};
 const rows=importedProductsWithMappings(products,[mapping]);
 assert.equal(rows[0].mapping.id,'m');assert.equal(rows[1].mapping.id,'m');
 assert.equal(rows[2].mapping.id,undefined);assert.equal(rows[3].mapping.id,undefined);
 const orders=[{id:'order',connection_id:'woo',marketplace:'website',stato:'completed',currency:'EUR'}];
 const lines=[{id:'line',order_id:'order',external_sku:'IT0198',quantity:2,line_revenue:20}];
 const reconciled=reconcileDigitalLines(orders,lines,[mapping]);
 assert.equal(reconciled[0].product_id,'canonical');
 assert.equal(digitalChannelKpis(orders,reconciled).products[0].code,'IT0198');
});

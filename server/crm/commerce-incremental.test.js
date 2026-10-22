import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchCommercePage,initialImportState} from './commerce-import.js';
const now=new Date('2026-10-22T10:00:00Z'),checkpoint='2026-10-21T20:57:00Z';
const woo={provider_code:'woocommerce',import_state:{completed:true,to:checkpoint},configurazione:{site_url:'https://shop.example'}};
const ok=data=>({ok:true,data});
test('WooCommerce ordinary orders use modification window, including old orders changed now',async()=>{
 const state={...initialImportState(woo,now),phase:'orders'};
 const page=await fetchCommercePage(woo,{},state,{now,fetcher:async url=>{
  const q=new URL(url).searchParams;assert.equal(q.get('modified_after'),state.from);assert.equal(q.get('modified_before'),state.to);assert.equal(q.get('dates_are_gmt'),'true');assert.equal(q.get('after'),null);
  return ok([{id:4,date_created_gmt:'2024-01-01T10:00:00',status:'completed',total:'12.2',total_tax:'2.2'}]);
 }});
 assert.equal(page.rows[0].external_id,'4');assert.equal(page.next.completed,true);
 assert.equal(page.next.to,state.to);assert.equal(woo.import_state.to,checkpoint);
});
test('initial WooCommerce history remains complete; subsequent pages retain the same modification window',async()=>{
 const initial={...initialImportState({...woo,import_state:{}},now),phase:'orders'};
 await fetchCommercePage(woo,{},initial,{now,fetcher:async url=>{assert.equal(new URL(url).searchParams.get('modified_after'),null);return ok([]);}});
 const state={...initialImportState(woo,now),phase:'orders',page:3},before=JSON.stringify(state);
 await assert.rejects(fetchCommercePage(woo,{},state,{now,fetcher:async()=>({ok:false,status:503,data:{}})}),/503/);
 assert.equal(JSON.stringify(state),before);
});
test('Amazon orders and listings share fixed update window, with cancelled status changes retained for reconciliation',async()=>{
 const connection={provider_code:'amazon_sp_api',import_state:{completed:true,to:checkpoint},marketplace_ids:['APJ6JRA9NG5V4'],configurazione:{region:'eu',seller_id:'s'}};
 const state=initialImportState(connection,now),calls=[];
 const fetcher=async url=>{
  if(url.includes('/auth/'))return ok({access_token:'private'});
  const u=new URL(url);calls.push(u);
  if(u.pathname.includes('/listings/')) {assert.equal(u.searchParams.get('lastUpdatedAfter'),state.from);return ok({items:[]});}
  assert.equal(u.searchParams.get('lastUpdatedAfter'),state.from);assert.equal(u.searchParams.get('lastUpdatedBefore'),state.to);
  return ok({orders:[{orderId:'123-1234567-1234567',createdTime:'2024-10-01T10:00:00Z',fulfillment:{fulfillmentStatus:'CANCELLED'},salesChannel:{marketplaceId:'APJ6JRA9NG5V4'}}]});
 };
 const catalog=await fetchCommercePage(connection,{},state,{now,fetcher});
 const orders=await fetchCommercePage(connection,{},catalog.next,{now,fetcher});
 assert.equal(orders.rows[0].stato,'CANCELLED');assert.equal(orders.next.completed,true);assert.equal(calls.length,2);
});

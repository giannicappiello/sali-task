import test from 'node:test';
import assert from 'node:assert/strict';
import {synchronizeCommerce} from './digital-connection-manager.js';
import {synchronizeShipmentDates} from './amazon-shipments.js';
import {fetchCommercePage} from './commerce-import.js';

function pipeline(shipping) {
  const state={id:'conn',provider_code:'amazon_sp_api',import_state:{completed:true,to:'2026-10-22T09:29:05Z'},amazon_cox_state:{},amazon_shipment_state:{reportId:'fatal-report'}};
  const calls=[],finishes=[];
  const db={rpc:async(name,args)=>{calls.push(name);if(name==='crm_claim_commerce_import_service')return {data:'run'};if(name==='crm_import_commerce_page_service')state.import_state=args.next_state;if(name==='crm_complete_sync_run_service')finishes.push(args);return {data:null};},
    from:()=>({update:values=>({eq:async()=>{Object.assign(state,values);return {data:null};}})})};
  const deps={readConnection:async()=>structuredClone(state),readSecrets:async()=>({}),fetchPage:async()=>{calls.push('orders');return {kind:'orders',rows:[{external_id:'one'},{external_id:'two'}],next:{completed:true,counts:{orders:2},to:'2026-10-26T10:00:00Z'},hasMore:false};},
    shipmentSync:async()=>{calls.push('shipments');if(shipping instanceof Error)throw shipping;return shipping;},coxSync:async()=>{calls.push('cox');state.amazon_cox_state={};return {hasMore:false,emitted:0,failed:0};}};
  return {state,calls,finishes,run:()=>synchronizeCommerce(db,null,state,'recovery',false,deps)};
}
test('orders commit before shipment reports; a FATAL report cannot stop the next import cycle',async()=>{
  const p=pipeline(new Error('Report FATAL'));
  const first=await p.run();assert.equal(first.resource,'orders');assert.equal(first.hasMore,true);assert.ok(!p.calls.includes('shipments'));
  assert.deepEqual(p.state.amazon_cox_state,{active:true,phase:'shipments'});
  const second=await p.run();assert.equal(second.status,'completed');assert.equal(second.shipmentWarning,'Report FATAL');
  assert.ok(p.state.amazon_shipment_state.retryAt);assert.equal(p.finishes.at(-1).target_details.shipmentWarning,'Report FATAL');
  await p.run();assert.equal(p.calls.filter(c=>c==='orders').length,2);
});
test('in-progress report keeps the post-import phase resumable and propagates retry delay',async()=>{
  const p=pipeline({hasMore:true,retryAfterMs:30000,recordsRead:0});await p.run();const r=await p.run();
  assert.equal(r.hasMore,true);assert.equal(r.retryAfterMs,30000);assert.equal(r.status,'partial');assert.ok(!p.calls.includes('cox'));
});

test('rolling retention replaces the old FATAL report with a valid window',async()=>{
  const calls=[],writes=[],now=new Date('2026-10-26T12:00:00Z');
  const result=await synchronizeShipmentDates({db:{rpc:async(n,args)=>{writes.push(args);return {data:null};}},connection:{id:'conn',provider_code:'amazon_sp_api',configurazione:{region:'eu'},amazon_shipment_state:{target:'2026-10-22T10:14:42Z',floor:'2025-04-22T10:17:42Z',start:'2025-04-22T10:17:42Z',end:'2025-04-30T10:14:42Z',reportId:'old-fatal',reports:18}},secrets:{},now,
    fetcher:async(url,opts)=>{calls.push({url,opts});return url.includes('/auth/')?{ok:true,data:{access_token:'private'}}:{ok:true,data:{reportId:'replacement'}};}});
  assert.ok(!calls.some(c=>c.url.includes('old-fatal')));const body=JSON.parse(calls[1].opts.body);
  assert.equal(body.dataStartTime,'2025-04-27T12:00:00.000Z');assert.equal(body.dataEndTime,'2025-04-30T10:14:42Z');
  assert.equal(writes[0].p_covered_at,null);assert.equal(result.hasMore,true);
});
test('FATAL preserves a missing window, defers retry and never reports false coverage',async()=>{
  const writes=[],now=new Date('2026-10-26T12:00:00Z'),connection={id:'conn',provider_code:'amazon_sp_api',configurazione:{region:'eu'},amazon_shipment_state:{target:'2026-10-26T10:00:00Z',floor:'2026-10-01T00:00:00Z',start:'2026-10-01T00:00:00Z',end:'2026-10-26T10:00:00Z',reportId:'bad'}};
  const db={rpc:async(n,args)=>{writes.push(args);return {data:null};}};
  const r=await synchronizeShipmentDates({db,connection,secrets:{},now,fetcher:async u=>u.includes('/auth/')?{ok:true,data:{access_token:'private'}}:{ok:true,data:{processingStatus:'FATAL'}}});
  assert.equal(r.deferred,true);assert.equal(r.hasMore,false);assert.match(r.warning,/FATAL/);assert.equal(writes[0].p_covered_at,null);assert.equal(writes[0].p_state.end,connection.amazon_shipment_state.end);assert.equal(writes[0].p_state.reportId,undefined);
  const retry=await synchronizeShipmentDates({db,connection:{...connection,amazon_shipment_state:writes[0].p_state},secrets:{},now,fetcher:async()=>{throw new Error('Must respect retry');}});assert.equal(retry.deferred,true);
});
test('expired order cursor replays its exact fixed window and retains all returned statuses',async()=>{
  const now=new Date('2026-10-26T12:00:00Z'),from='2026-10-22T09:29:04Z',to='2026-10-26T11:57:00Z';let queries=[];
  const page=await fetchCommercePage({provider_code:'amazon_sp_api',marketplace_ids:['IT'],configurazione:{region:'eu'}},{},{version:1,phase:'orders',priorityImported:true,completed:false,from,to,token:'expired',updatedAt:'2026-10-22T10:00:00Z',counts:{orders:0}},{now,fetcher:async u=>{if(u.includes('/auth/'))return {ok:true,data:{access_token:'private'}};queries.push(new URL(u).searchParams);return {ok:true,data:{orders:[{orderId:'unfulfillable',salesChannel:{marketplaceId:'IT'},fulfillment:{fulfillmentStatus:'UNFULFILLABLE'}},{orderId:'other-status',salesChannel:{marketplaceId:'IT'},fulfillment:{fulfillmentStatus:'NEW_STATUS'}}]}};}});
  assert.equal(queries[0].has('paginationToken'),false);assert.equal(queries[0].get('lastUpdatedAfter'),from);assert.equal(queries[0].get('lastUpdatedBefore'),to);
  assert.equal(page.rows.length,2);assert.equal(page.next.completed,true);
});

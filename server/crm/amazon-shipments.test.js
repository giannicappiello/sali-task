import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {shipmentReportDates,packageShippedAt,synchronizeShipmentDates} from './amazon-shipments.js';
const id='123-1234567-1234567';
const tsv='amazon-order-id\tshipment-date\tbuyer-email\n'+id+'\t2026-10-21T23:00:00+00:00\tprivate@example.test\n'+id+'\t2026-10-22T01:00:00+00:00\tprivate@example.test\n';
test('shipment report keeps latest package date per order and strips PII',()=>{
 assert.deepEqual(shipmentReportDates(tsv),[{external_id:id,shipped_at:'2026-10-22T01:00:00.000Z'}]);
 assert.throws(()=>shipmentReportDates(tsv.replaceAll('+00:00','')),/non valida/);
 assert.throws(()=>shipmentReportDates('order-id\tdate\n'),/senza/);
});
test('only fully shipped FBM orders with every package date use package timestamps',()=>{
 const o={fulfillment:{fulfillmentStatus:'SHIPPED'},packages:[{shipTime:'2026-10-21T10:00:00Z'},{shipTime:'2026-10-22T10:00:00Z'}]};
 assert.equal(packageShippedAt(o),'2026-10-22T10:00:00.000Z');
 assert.equal(packageShippedAt({...o,fulfillment:{fulfillmentStatus:'PARTIALLY_SHIPPED'}}),null);
 assert.equal(packageShippedAt({...o,packages:[...o.packages,{}]}),null);
});
test('report job persists resumable windows and downloads gzip without credentials',async()=>{
 const writes=[],calls=[],connection={id:'c',marketplace_ids:['IT'],provider_code:'amazon_sp_api',configurazione:{region:'eu',lwa_client_id:'client'}};
 const db={rpc:async(name,args)=>{writes.push({name,args});return {data:null};}};
 const now=new Date('2026-10-22T12:00:00Z');
 const fetcher=async(url,options)=>{
  calls.push({url,options});
  if(url.includes('/auth/'))return {ok:true,data:{access_token:'secret'}};
  if(url.endsWith('/reports'))return {ok:true,data:{reportId:'r1'}};
  if(url.endsWith('/reports/r1'))return {ok:true,data:{processingStatus:'DONE',reportDocumentId:'d1'}};
  if(url.includes('/documents/'))return {ok:true,data:{url:'https://download.example/report',compressionAlgorithm:'GZIP'}};
  assert.equal(options.headers,undefined);return {ok:true,data:gzipSync(tsv)};
 };
 const first=await synchronizeShipmentDates({db,connection,secrets:{},fetcher,now});
 assert.equal(first.hasMore,true);assert.equal(first.retryAfterMs,30000);
 assert.equal(writes[0].args.p_state.reportId,'r1');
 assert.equal(connection.amazon_shipment_state,undefined);
 const body=JSON.parse(calls[1].options.body);
 assert.equal((Date.parse(body.dataEndTime)-Date.parse(body.dataStartTime))/86400000,30);
 await synchronizeShipmentDates({db,connection:{...connection,amazon_shipment_state:writes[0].args.p_state},secrets:{},fetcher,now});
 assert.equal(writes.at(-1).args.p_rows.length,1);
 assert.ok(!JSON.stringify(writes).includes('private@example'));
});
test('denied reports do not advance cursor and cannot trigger COX',async()=>{
 let writes=0;
 await assert.rejects(synchronizeShipmentDates({db:{rpc:async()=>{writes++;}},connection:{configurazione:{region:'eu'},marketplace_ids:['IT']},secrets:{},fetcher:async url=>url.includes('/auth/')?{ok:true,data:{access_token:'secret'}}:{ok:false,status:403,data:{}}}),/403/);
 assert.equal(writes,0);
});

test('evening sync refreshes shipment data acquired earlier on the same day',async()=>{
 const writes=[],requests=[];
 const connection={id:'c',configurazione:{region:'eu'},marketplace_ids:['IT'],amazon_shipments_covered_at:'2026-10-27T09:41:41.180Z',import_state:{completed:true,to:'2026-10-27T21:57:03.076Z'}};
 const result=await synchronizeShipmentDates({db:{rpc:async(name,args)=>{writes.push({name,args});return {data:null};}},connection,secrets:{},now:new Date('2026-10-27T22:00:10Z'),fetcher:async(url,options)=>{
  if(url.includes('/auth/'))return {ok:true,data:{access_token:'secret'}};
  requests.push(JSON.parse(options.body));return {ok:true,data:{reportId:'evening-report'}};
 }});
 assert.equal(result.hasMore,true);assert.equal(result.retryAfterMs,30000);
 assert.equal(requests[0].dataEndTime,'2026-10-27T21:57:03.076Z');
 assert.equal(writes[0].args.p_state.reportId,'evening-report');
 assert.equal(writes[0].args.p_covered_at,null);
});

test('shipment coverage already reaching the committed import window does not create another report',async()=>{
 const result=await synchronizeShipmentDates({db:{rpc:async()=>assert.fail('No coverage change needed')},connection:{amazon_shipments_covered_at:'2026-10-27T21:57:03.076Z',import_state:{to:'2026-10-27T21:57:03.076Z'}},secrets:{},now:new Date('2026-10-27T22:30:00Z'),fetcher:async()=>assert.fail('No new provider call needed')});
 assert.equal(result.hasMore,false);
});

test('explicit shipment refresh can advance beyond the last order import window',async()=>{
 let requestBody;
 await synchronizeShipmentDates({db:{rpc:async()=>({data:null})},connection:{id:'c',configurazione:{region:'eu'},marketplace_ids:['IT'],amazon_shipments_covered_at:'2026-10-27T09:00:00Z',import_state:{to:'2026-10-27T09:00:00Z'}},secrets:{},now:new Date('2026-10-27T22:00:00Z'),coverageThrough:'2026-10-27T21:57:00Z',fetcher:async(url,options)=>{
  if(url.includes('/auth/'))return {ok:true,data:{access_token:'secret'}};
  requestBody=JSON.parse(options.body);return {ok:true,data:{reportId:'manual-refresh'}};
 }});
 assert.equal(requestBody.dataEndTime,'2026-10-27T21:57:00.000Z');
});


/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import {financialTransactions,safeFinancialTransaction,returnReportRows,legacyRefundEvents,refundFinancialEvents} from './amazon-returns-source.js';
import {handleDigitalConnectionManager as handler} from './digital-connection-manager.js';

test('financial source preserves refund identifiers and monetary trees without customer PII',async()=>{
 const source={transactionId:'event-1',transactionType:'Refund',transactionStatus:'RELEASED',description:'Customer private',postedDate:'2026-10-26T08:00:00Z',
  relatedIdentifiers:[{relatedIdentifierName:'ORDER_ID',relatedIdentifierValue:'405-5097949-2429931'}],
  items:[{description:'Private',contexts:[{contextType:'ProductContext',sku:'IT0058 - FBA',quantityShipped:1,buyerName:'Private'}],breakdowns:[{breakdownType:'Principal',breakdownAmount:{currencyAmount:-12.05,currencyCode:'EUR'}}]}]};
 const requests=[];
 const data=await financialTransactions({provider_code:'amazon_sp_api',configurazione:{region:'eu'}},{},{orderId:'405-5097949-2429931',fetcher:async(url,options)=>{requests.push({url,options});return {ok:true,data:url.includes('/auth/')?{access_token:'secret'}:{payload:{transactions:[source],nextToken:'next'}}};}});
 assert.equal(data.transactions[0].items[0].breakdowns[0].breakdownAmount.currencyAmount,-12.05);
 assert.equal(data.nextToken,'next');assert.ok(!JSON.stringify(data).match(/Private|secret/));
 assert.equal(new URL(requests[1].url).searchParams.get('relatedIdentifierName'),'ORDER_ID');
 assert.throws(()=>safeFinancialTransaction({...source,breakdowns:Array(101).fill({})}),/esteso/);
});

test('FBA report keeps disposition and return identity but never customer comments',()=>{
 const rows=returnReportRows('return-date\torder-id\tsku\tquantity\tdetailed-disposition\tstatus\tlicense-plate-number\tcustomer-comments\n2026-10-26T08:00:00Z\t405-5097949-2429931\tIT0058 - FBA\t1\tSELLABLE\tUnit returned to inventory\tLPN-1\tPrivate\n');
 assert.equal(rows[0]['detailed-disposition'],'SELLABLE');assert.equal(rows[0]['license-plate-number'],'LPN-1');assert.ok(!JSON.stringify(rows).includes('Private'));
 assert.throws(()=>returnReportRows('order-id\n405-5097949-2429931'),/senza campo/);
});

test('legacy refund source preserves adjustments and discounts without buyer identity',async()=>{
 assert.equal(refundFinancialEvents,legacyRefundEvents);
 const urls=[];
 const result=await legacyRefundEvents({provider_code:'amazon_sp_api',configurazione:{region:'eu'}},{},{orderId:'405-5097949-2429931',fetcher:async url=>{
  urls.push(url);return {ok:true,data:url.includes('/auth/')?{access_token:'secret'}:{payload:{FinancialEvents:{RefundEventList:[{AmazonOrderId:'405-5097949-2429931',BuyerName:'PRIVATE',ShipmentItemAdjustmentList:[{OrderAdjustmentItemId:'adjustment-1',SellerSKU:'IT0058 - FBA',QuantityShipped:1,ItemChargeAdjustmentList:[{ChargeType:'Principal',ChargeAmount:{CurrencyAmount:-12.05,CurrencyCode:'EUR'}}],PromotionAdjustmentList:[{PromotionId:'discount-1',PromotionAmount:{CurrencyAmount:1,CurrencyCode:'EUR'}}]}]}]},NextToken:'next'}}};
 }});
 assert.match(urls[1],/\/finances\/v0\/orders\/405-5097949-2429931\/financialEvents/);
 assert.equal(result.refunds[0].ShipmentItemAdjustmentList[0].OrderAdjustmentItemId,'adjustment-1');
 assert.equal(result.refunds[0].ShipmentItemAdjustmentList[0].PromotionAdjustmentList[0].PromotionAmount.CurrencyAmount,1);
 assert.equal(result.nextToken,'next');assert.ok(!JSON.stringify(result).includes('PRIVATE'));
 assert.equal(result.sourceApi,'finances_v0');
 assert.equal(result.includesDeferredTransactions,false);
});

test('financial authorization failure retains only the safe Amazon request reference for support',async()=>{
 await assert.rejects(()=>financialTransactions({provider_code:'amazon_sp_api',configurazione:{region:'eu'}},{},{orderId:'405-5097949-2429931',fetcher:async url=>url.includes('/auth/')?{ok:true,data:{access_token:'secret'}}:{ok:false,status:403,headers:{'x-amzn-requestid':'request-123','authorization':'secret'},data:{errors:[{code:'Unauthorized',message:'Access denied'}]}}}),error=>{
  assert.equal(error.providerRequestId,'request-123');assert.equal(error.code,'provider_403');assert.ok(!JSON.stringify(error).includes('secret'));return true;
 });
});

test('refund date cursor scans and resumes the official financial API without losing its time window',async()=>{
 let called;
 const result=await refundFinancialEvents({provider_code:'amazon_sp_api',configurazione:{region:'eu'}},{},{from:'2026-10-21T00:00:00Z',to:'2026-10-27T08:00:00Z',nextToken:'page-2',fetcher:async url=>{
  if(url.includes('/auth/'))return {ok:true,data:{access_token:'secret'}};
  called=new URL(url);return {ok:true,data:{payload:{FinancialEvents:{}}}};
 }});
 assert.equal(called.pathname,'/finances/v0/financialEvents');
 assert.equal(called.searchParams.get('PostedAfter'),'2026-10-21T00:00:00Z');
 assert.equal(called.searchParams.get('PostedBefore'),'2026-10-27T08:00:00Z');
 assert.equal(called.searchParams.get('NextToken'),'page-2');
 assert.deepEqual(result.refunds,[]);assert.equal(result.nextToken,null);
});

test('returns diagnostic rejects missing service authorization before provider access',async()=>{
 const previous=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-key';
 try{
  let status,body;
  const res={setHeader(){},status(value){status=value;return this;},json(value){body=value;return this;}};
  await handler({method:'POST',headers:{},body:{action:'amazon_returns_probe',id:'fake'}},res);
  assert.equal(status,401);assert.equal(body.success,false);
 }finally{if(previous===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previous;}
});

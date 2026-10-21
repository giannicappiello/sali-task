import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchAmazonOrderWithBuyer,probeAmazonBuyer,amazonBuyerUnavailable} from './amazon-buyer.js';
import {loadDigitalOrderDetail} from './digital-order-detail.js';
const connection={id:'conn',provider_code:'amazon_sp_api',tipo:'amazon_seller',abilitata:true,configurazione:{region:'eu',lwa_client_id:'client'}};
const secrets={lwa_refresh_token:'refresh-private',lwa_client_secret:'secret-private'};
const raw={orderId:'123-1234567-1234567',fulfillment:{fulfillmentStatus:'SHIPPED'},buyer:{buyerName:'  Nome Acquirente  ',buyerEmail:'not-requested@example.com'},orderItems:[]};
function transport(mode){const calls=[];return {calls,fetcher:async(url)=>{calls.push(url);if(url.includes('/auth/'))return {ok:true,status:200,data:{access_token:'access-private'}};
  if(mode==='denied'&&url.includes('BUYER'))return {ok:false,status:403,data:{errors:[{code:'Unauthorized',message:'No buyer role access-private'}]}};
  if(mode==='outage')return {ok:false,status:503};
  if(mode==='allDenied')return {ok:false,status:403};
  return {ok:true,status:200,data:{order:{...raw,...(mode==='wrongOrder'?{orderId:'other'}:{}),buyer:mode==='provided'?raw.buyer:undefined}}};
}};}
test('BUYER request uses current API and returns name without buyer email or tokens',async()=>{
  const t=transport('provided');const result=await fetchAmazonOrderWithBuyer(connection,secrets,raw.orderId,t);
  assert.equal(result.customerName,'Nome Acquirente');assert.equal(result.buyerAccess,'provided');
  assert.ok(t.calls[1].includes('includedData=PROCEEDS,FULFILLMENT,BUYER'));
  assert.ok(!t.calls.some(u=>u.includes('RECIPIENT')));
  assert.ok(!JSON.stringify(result.customerName).includes('private'));
});
test('buyer denial falls back to normal order data; omissions are distinguished from denials',async()=>{
  for(const mode of ['denied','missing']){const t=transport(mode);const result=await fetchAmazonOrderWithBuyer(connection,secrets,raw.orderId,t);
    assert.equal(result.customerName,null);assert.equal(result.buyerAccess,mode==='denied'?'denied':'not_provided');
    assert.equal(t.calls.length,mode==='denied'?3:2);
  }
  assert.match(amazonBuyerUnavailable('denied','SHIPPED'),/negato/);
  assert.match(amazonBuyerUnavailable('not_provided','PENDING'),/in attesa/);
});
test('outage, wrong order and baseline denial do not masquerade as missing buyer roles',async()=>{
  for(const mode of ['outage','wrongOrder','allDenied'])await assert.rejects(fetchAmazonOrderWithBuyer(connection,secrets,raw.orderId,transport(mode)));
});
test('probe checks authorization before reading secrets and exposes no names or emails',async()=>{
  let read=false;
  await assert.rejects(probeAmazonBuyer({authorize:async()=>{throw new Error('forbidden');},loadOrder:async()=>{read=true;}}),/forbidden/);assert.equal(read,false);
  const result=await probeAmazonBuyer({authorize:async()=>{},loadOrder:async()=>({connection_id:'conn',external_id:raw.orderId}),connection:async()=>connection,secrets:async()=>secrets,fetcher:transport('provided').fetcher});
  assert.equal(result.available,true);assert.equal(result.buyerAccess,'provided');assert.ok(!JSON.stringify(result).includes('Nome Acquirente'));assert.ok(!JSON.stringify(result).includes('@'));
});
test('order detail displays the authorized live name, and buyer denial preserves imported financial data',async()=>{
  for(const mode of ['provided','denied']){
    const result=await loadDigitalOrderDetail('id',{visibleOrder:async()=>({id:'id',connection_id:'conn',external_id:raw.orderId,gross_revenue:14.7,net_revenue:12.05,stato:'SHIPPED'}),
      connection:async()=>connection,authorizeScreen:async()=>{},cachedLines:async()=>[],secrets:async()=>secrets,fetcher:transport(mode).fetcher});
    assert.equal(result.order.customerName,mode==='provided'?'Nome Acquirente':null);assert.equal(result.order.total,14.7);
    assert.equal(result.order.warning,null);assert.ok(!JSON.stringify(result).includes('not-requested@example.com'));
    if(mode==='denied')assert.match(result.order.customerUnavailable,/negato/);
  }
});

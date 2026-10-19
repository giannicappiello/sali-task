import test from 'node:test';
import assert from 'node:assert/strict';
import {testProviderConnection} from './digital-provider-adapters.js';
const connection={provider_code:'amazon_sp_api',configurazione:{region:'eu',lwa_client_id:'client-id'}};
const secrets={lwa_refresh_token:'refresh-private',lwa_client_secret:'client-secret-private'};

test('Amazon Seller sends required headers and uses the configured regional endpoint',async()=>{
 const calls=[];
 const result=await testProviderConnection(connection,secrets,{fetcher:async(url,options)=>{
  calls.push({url,options});
  return calls.length===1 ? {ok:true,status:200,data:{access_token:'access-private'}} : {ok:true,status:200,data:{payload:[{marketplace:{id:'APJ6JRA9NG5V4',name:'Amazon.it',defaultCurrencyCode:'EUR'}}]}};
 }});
 assert.equal(calls[0].url,'https://api.amazon.com/auth/o2/token');
 assert.equal(new URLSearchParams(calls[0].options.body).get('refresh_token'),secrets.lwa_refresh_token);
 assert.match(calls[1].url,/sellingpartnerapi-eu\.amazon\.com\/sellers\/v1\/marketplaceParticipations$/);
 assert.match(calls[1].options.headers['user-agent'],/^Workspace\/1\.0 \(Language=JavaScript/);
 assert.match(calls[1].options.headers['x-amz-date'],/^\d{8}T\d{6}Z$/);
 assert.equal(calls[1].options.headers['x-amz-access-token'],'access-private');
 assert.equal(result.accounts[0].external_id,'APJ6JRA9NG5V4');
 assert.ok(!JSON.stringify(result).includes('private'));
});

test('Amazon SP-API array errors retain the rejected stage and reason without leaking the access token',async()=>{
 let calls=0;
 await assert.rejects(testProviderConnection(connection,secrets,{fetcher:async()=>++calls===1
  ? {ok:true,status:200,data:{access_token:'access-private'}}
  : {ok:false,status:403,data:{errors:[{code:'Unauthorized',message:'Access denied for access-private'}]}}}),error=>{
   assert.equal(error.code,'provider_403');assert.equal(error.status,422);
   assert.match(error.message,/Amazon Seller SP-API HTTP 403/);assert.match(error.message,/Unauthorized/);
   assert.ok(!error.message.includes('access-private'));assert.match(error.message,/REDACTED/);return true;
  });
});

test('Amazon LWA rejection is distinguished from Seller permissions and hides form secrets',async()=>{
 await assert.rejects(testProviderConnection(connection,secrets,{fetcher:async()=>({ok:false,status:400,data:{error:'invalid_client',error_description:'Rejected client-secret-private and refresh-private'}})}),error=>{
  assert.match(error.message,/Autenticazione Amazon \(LWA\) HTTP 400/);assert.match(error.message,/invalid_client/);
  assert.ok(!error.message.includes(secrets.lwa_client_secret));assert.ok(!error.message.includes(secrets.lwa_refresh_token));return true;
 });
});
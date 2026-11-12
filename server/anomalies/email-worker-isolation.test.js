import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import {createEmailWorkerHandler} from '../../api/mexal/orders/email-worker.js';

test('anomaly-only consumer never claims another queue, including with report_protocol advertised',async()=>{
 const old=process.env.ARUBA_EMAIL_WORKER_SECRET;
 process.env.ARUBA_EMAIL_WORKER_SECRET='test-anomaly-secret';
 try{
  for(const result of [null,{id:'11111111-1111-4111-8111-111111111111',recipient_email:'a@example.test',subject:'s',body:'b',lock_token:'lock'}]){
   const calls=[];let code,payload;
   const handler=createEmailWorkerHandler({getClient:()=>({rpc:async(name)=>{calls.push(name);return {data:result};}})});
   await handler({method:'POST',headers:{authorization:'Bearer test-anomaly-secret'},body:{action:'claim',anomaly_only:true,report_protocol:1,activity_only:true,activity_email_protocol:99}},{status(x){code=x;return this;},json(x){payload=x;return x;}});
   assert.equal(code,200);assert.deepEqual(calls,['anomaly_claim_email']);assert.equal(payload.status,result?'claimed':'idle');
  }
 }finally{if(old===undefined)delete process.env.ARUBA_EMAIL_WORKER_SECRET;else process.env.ARUBA_EMAIL_WORKER_SECRET=old;}
});

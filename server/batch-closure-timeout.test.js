import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgremesProductionClient } from './progremes-production-client.js';

test('packaging closure waits 120 seconds while ordinary reads retain their short timeout',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const env={PROGREMES_URL:'https://mes.example.test',PROGREMES_INTEGRATION_SECRET:'test-secret',PROGREMES_API_TIMEOUT_MS:'1000'};
 const make=()=>{
  let aborted=false;
  const client=createProgremesProductionClient({env,fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>{
   signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true});
  })});
  return {client,isAborted:()=>aborted};
 };
 const closure=make();
 const promise=closure.client.batchSheet({externalId:'test',operation:'complete-sheet'});
 const rejection=assert.rejects(promise,{code:'PROGREMES_TIMEOUT'});
 t.mock.timers.tick(119999);
 assert.equal(closure.isAborted(),false);
 t.mock.timers.tick(1);
 await rejection;
 assert.equal(closure.isAborted(),true);
 const read=make();
 const reading=assert.rejects(read.client.batchSheet({externalId:'test',operation:'list'}),{code:'PROGREMES_TIMEOUT'});
 t.mock.timers.tick(1000);
 await reading;
 assert.equal(read.isAborted(),true);
});
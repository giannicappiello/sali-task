import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgremesProductionClient } from './progremes-production-client.js';
const env={PROGREMES_URL:'https://mes.test',PROGREMES_INTEGRATION_SECRET:'test',PROGREMES_API_TIMEOUT_MS:'1000'};
test('il foglio ha 120 secondi e il timeout non ripete operazioni',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let calls=0;
 const client=createProgremesProductionClient({env,fetchImpl:async(_url,{signal})=>{calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));}});
 const promise=client.preparationActions({operation:'sheet',externalId:'test'});
 let settled=false;promise.catch(()=>{settled=true;});
 const expected=assert.rejects(promise,{status:504,code:'PROGREMES_TIMEOUT'});
 t.mock.timers.tick(30000);await Promise.resolve();assert.equal(settled,false);
 t.mock.timers.tick(90000);await expected;assert.equal(calls,1);
});
test('il contesto mantiene il timeout standard',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const client=createProgremesProductionClient({env,fetchImpl:async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))});
 const expected=assert.rejects(client.preparationActions({operation:'context',externalId:'test'}),{status:504});
 t.mock.timers.tick(1000);await expected;
});

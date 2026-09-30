import test from 'node:test';
import assert from 'node:assert/strict';
import {editProductionDates} from './production-date-editor.js';
const session={profile:{id:'operator'}},row={mes_order_id:12,evidence:{orderNumber:'RDP12',works:[{id:7}]}};
test('foreign production cannot reach MES',async()=>{
 await assert.rejects(editProductionDates(session,row,{targetId:8},()=>assert.fail('transport')),/non appartenente/);
});
test('date save binds authoritative target and actor and keeps the retry key',async()=>{
 const oldUrl=process.env.PROGREMES_URL,oldSecret=process.env.PROGREMES_INTEGRATION_SECRET;
 process.env.PROGREMES_URL='https://mes.example';process.env.PROGREMES_INTEGRATION_SECRET='test-secret';
 try{
  const key='bda5d4c7-d854-4089-9480-7eeb7a8e664b';
  const result=await editProductionDates(session,row,{targetId:7,operation:'dates-save',requestId:key,actor:'forged',expectedHash:'a'.repeat(64),newStartDate:'2026-08-01',reason:'Rettifica verificata'},async(url,options)=>{
   const payload=JSON.parse(options.body);assert.equal(url.pathname,'/api/workspace/ai/actions/apply');assert.equal(payload.target,'7');assert.equal(payload.actor,'workspace:operator');assert.equal(payload.idempotencyKey,key);assert.equal(payload.input.alignBoundaryPresences,false);assert.equal(payload.input.newStartTime,null);
   return {ok:true,json:async()=>({applied:true})};
  });assert.equal(result.applied,true);
 }finally{if(oldUrl===undefined)delete process.env.PROGREMES_URL;else process.env.PROGREMES_URL=oldUrl;if(oldSecret===undefined)delete process.env.PROGREMES_INTEGRATION_SECRET;else process.env.PROGREMES_INTEGRATION_SECRET=oldSecret;}
});

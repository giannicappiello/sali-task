import test from 'node:test';
import assert from 'node:assert/strict';
import {batchPrintStart} from './batchPrintStart.js';
test('all Station batches start only after confirmed printing',async()=>{
 for(const station of ['ST01','ST02','ST3','ST4','ST5','ST6','ST7','ST8','ST9','ST10','ST11']) {
  const calls=[];
  assert.equal(await batchPrintStart({alreadyPrinted:false,print:async()=>{calls.push('print');return {status:'Completed',confirmedAt:'now'};},onPrinted:()=>calls.push('confirmed'),start:async()=>calls.push(station)}),true);
  assert.deepEqual(calls,['print','confirmed',station]);
 }
});
test('pending, failed and unconfirmed prints never start production',async()=>{
 for(const job of [null,{status:'Queued'},{status:'Failed'},{status:'Completed'},{status:'Completed',confirmedAt:'now',confirmationError:'changed sheet'}]) {
  let started=false;
  const action=batchPrintStart({alreadyPrinted:false,print:async()=>job,onPrinted:()=>{},start:async()=>{started=true;}});
  if(job) await assert.rejects(action); else assert.equal(await action,false);
  assert.equal(started,false);
 }
});
test('retry after start failure reuses confirmed print',async()=>{
 let printed=false,prints=0,starts=0;
 const options=()=>({alreadyPrinted:printed,print:async()=>{prints++;return {status:'Completed',confirmedAt:'now'};},onPrinted:()=>{printed=true;},start:async()=>{if(++starts===1)throw new Error('Station occupata');}});
 await assert.rejects(batchPrintStart(options()));
 assert.equal(await batchPrintStart(options()),true);
 assert.equal(prints,1);assert.equal(starts,2);
});

test('durable print-start confirmation does not issue a second start', async () => {
 let starts=0;
 assert.equal(await batchPrintStart({alreadyPrinted:false, print:async()=>({status:'Completed',confirmedAt:'now',sheet:{startAfterPrint:true}}),onPrinted:()=>{},start:async()=>{starts++;}}),true);
 assert.equal(starts,0);
});

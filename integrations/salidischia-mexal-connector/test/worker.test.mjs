import test from'node:test';import assert from'node:assert/strict';
import{runBatch}from'../src/worker.mjs';import{Journal}from'../src/journal.mjs';import{exampleOrder,config,options}from'./fixtures.mjs';
const settings={...config,...options,importFrom:'2026-10-01',legacyReconciledThrough:13728};
test('worker anteprima legge entrambi gli stati senza scritture',async()=>{
 const calls=[],journal=new Journal(':memory:');
 const woo={async orders(q){calls.push(q);return[exampleOrder()];}};
 const result=await runBatch({woo,mexal:{},journal,config:settings});assert.equal(result.processed,1);assert.equal(result.results[0].mode,'preview');
 assert.deepEqual(calls.map(x=>x.status),['processing','completed']);journal.close();
});
test('worker esclude gli ordini del vecchio flusso',async()=>{
 const journal=new Journal(':memory:');const result=await runBatch({woo:{async orders(){return[exampleOrder()];}},mexal:{},journal,config:{...settings,legacyReconciledThrough:13729}});
 assert.equal(result.processed,0);journal.close();
});
test('worker non attivabile se il vecchio connettore non è fermato',async()=>{
 await assert.rejects(runBatch({config:{...settings,cutoverVerified:false},dryRun:false}),/non verificato/);
});
test('worker segnala ordini errati senza attribuire un invio riuscito',async()=>{
 const journal=new Journal(':memory:'),order=exampleOrder();order.total='1.00';
 const result=await runBatch({woo:{async orders(){return[order];}},mexal:{},journal,config:settings});assert.equal(result.results[0].mode,'attention-required');journal.close();
});
test('worker blocca pagine ripetute e non invia elenchi incompleti',async()=>{
 const rows=Array.from({length:100},(_,i)=>({...exampleOrder(),id:14000+i}));
 await assert.rejects(runBatch({woo:{async orders(){return rows;}},config:settings}),/ripetuta/);
});

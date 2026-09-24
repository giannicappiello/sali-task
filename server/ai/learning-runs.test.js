import test from 'node:test';
import assert from 'node:assert/strict';
import {recordLearningRun} from './learning-runs.js';
function database(){
 const writes=[];
 return {writes,admin:{from(){return {
   insert(value){writes.push(value);return {select(){return {single:async()=>({data:{id:'run-1'}})};}};},
   update(value){writes.push(value);return {eq:async()=>({error:null})};},
 };}}};
}
for(const [result,state] of [[{created:0,candidates:0},'no_evidence'],[{created:0,candidates:0,connectorDisabled:true},'connector_disabled'],[{created:2,candidates:4},'completed']]){
 test(`persists ${state} instead of a silent scan`,async()=>{
  const {admin,writes}=database();
  const output=await recordLearningRun(admin,async()=>result);
  assert.equal(output.runId,'run-1');
  assert.equal(writes[0].state,'running');
  assert.equal(writes[1].state,state);
  assert.ok(writes[1].finished_at);
 });
}
test('records failure without persisting sensitive connector details',async()=>{
 const {admin,writes}=database();
 const error=new Error('https://private/?secret=do-not-store');
 await assert.rejects(recordLearningRun(admin,async()=>{throw error;}),failure=>failure.cause===error&&failure.runId==='run-1');
 assert.equal(writes[1].state,'failed');
 assert.equal(JSON.stringify(writes).includes('do-not-store'),false);
});

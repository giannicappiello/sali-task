import test from 'node:test';
import assert from 'node:assert/strict';
import {productionCostTools,cleanCostDraft} from '../server/ai/production-cost-tools.js';
const auth={token:'caller',capabilities:{internal_data:true}};
test('no internal data entitlement means no cost tools',()=>assert.deepEqual(productionCostTools({capabilities:{}}),{}));
test('proposal uses unsaved draft and caller authorization, never saves a version',async()=>{
 const calls=[];const draft={machines:[],laborHourly:32};
 const tools=productionCostTools(auth,{productionCostSettings:draft},async(req,body)=>{assert.equal(req.headers.authorization,'Bearer caller');calls.push(body);return body.operation==='configuration'?{configurations:[{settings:{machines:[],laborHourly:10}}]}:{proposal:{id:'proposal'}};});
 const result=await tools.PRODUCTION_COST_PROPOSE.execute({prompt:'modifica criterio',parentId:'parent'});
 assert.equal(calls[1].settings.laborHourly,32);assert.equal(calls[1].parentId,'parent');assert.equal(result.applied,false);
 assert.deepEqual(calls.map(c=>c.operation),['configuration','ai-propose']);
});
test('configuration permission failure prevents any proposal',async()=>{
 let count=0;const tools=productionCostTools(auth,null,async()=>{count++;throw new Error('denied');});
 await assert.rejects(()=>tools.PRODUCTION_COST_PROPOSE.execute({prompt:'x'}),/denied/);assert.equal(count,1);
});
test('absent screen uses saved configuration; historical proposal stays owner-scoped through endpoint',async()=>{
 const calls=[];const tools=productionCostTools(auth,null,async(req,body)=>{calls.push(body);return body.operation==='configuration'?{configurations:[{settings:{machines:[],laborHourly:12}}]}:{proposal:{id:'p'}};});
 await tools.PRODUCTION_COST_PROPOSE.execute({prompt:'x'});assert.equal(calls[1].settings.laborHourly,12);
 await tools.PRODUCTION_COST_PROPOSALS.execute({id:'historical'});assert.deepEqual(calls[2],{operation:'ai-proposal',id:'historical'});
});
test('draft is bounded and copied',()=>{assert.equal(cleanCostDraft({machines:[],text:'x'.repeat(80001)}),null);assert.equal(cleanCostDraft([]),null);const value={machines:[]};assert.notEqual(cleanCostDraft(value),value);});

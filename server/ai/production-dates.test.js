import test from 'node:test';
import assert from 'node:assert/strict';
import { mesDomainCall } from './formula-revisions.js';
import { productionStartSchema } from './production-dates.js';
import { availableControlledActions } from './controlled-actions.js';

test('date lookup rejects missing MES permission before transport',async()=>{
 const auth={profile:{id:'operator'},scoped:{rpc:async()=>({data:false})}};
 await assert.rejects(mesDomainCall(auth,'production-dates','lookup',{query:'OC2/157'},()=>assert.fail('unauthorized transport')),e=>e.status===403);
});
test('date correction is explicit and never available to analysis-only or non-MES profiles',()=>{
 for(const capabilities of [{role_ai_level:'analisi',progremes:true},{role_ai_level:'conferma',progremes:false}])
  assert.equal(availableControlledActions({profile:{ruoli:{}},capabilities}).MES_PRODUCTION_START_CORRECT,undefined);
 assert.ok(availableControlledActions({profile:{ruoli:{amministratore_workspace:true}},capabilities:{progremes:true}}).MES_PRODUCTION_START_CORRECT);
 assert.equal(productionStartSchema.additionalProperties,false);
 assert.deepEqual(productionStartSchema.required,['targetId','expectedHash','newStartDate','reason']);
 assert.ok(new RegExp(productionStartSchema.properties.newStartDate.pattern).test('2026-09-23'));
 assert.ok(!new RegExp(productionStartSchema.properties.newStartDate.pattern).test('23/09/2026'));
});

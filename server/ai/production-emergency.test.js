import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAnomaly, hasEmergencyPermission, assertEmergencyPermission, readProductionPermissions, productionEmergencyTools } from './production-emergency.js';
import { availableControlledActions, proposeControlledAction, decideControlledAction } from './controlled-actions.js';
const code='progremes.production.reopen';
const admin={profile:{id:'operator',ruoli:{amministratore_workspace:true}},capabilities:{progremes:true,internal_data:true,role_ai_level:'conferma'},productionPermissions:[]};
test('administrator and AI confirmation level never substitute an explicit emergency grant',()=>{
 const actions=availableControlledActions(admin);
 for(const tool of ['MES_PRODUCTION_FORCE_START','MES_PRODUCTION_REOPEN','MES_PRODUCTION_FORCE_CLOSE']) {
  assert.equal(actions[tool],undefined);assert.equal(hasEmergencyPermission(admin,tool),false);
 }
 assert.ok(actions.MES_PRODUCTION_START);
});
test('the three emergency permissions are independent',()=>{
 const actions=availableControlledActions({...admin,productionPermissions:[code]});
 assert.ok(actions.MES_PRODUCTION_REOPEN);assert.equal(actions.MES_PRODUCTION_FORCE_START,undefined);assert.equal(actions.MES_PRODUCTION_FORCE_CLOSE,undefined);
});
test('permission lookup fails closed and does not accept an admin flag',async()=>{
 await assert.rejects(readProductionPermissions({...admin,scoped:{rpc:async()=>({error:{message:'missing migration'}})}}),/non verificabili/);
 await assert.rejects(assertEmergencyPermission({...admin,scoped:{rpc:async()=>({data:[]})}},'MES_PRODUCTION_REOPEN'),/Permesso specifico/);
});
test('anomaly and business reason are distinct required values',()=>{
 const value={anomalyType:'software',anomalyDescription:'Chiusura registrata per errore',reason:'Verificare il completamento fisico'};
 assert.doesNotThrow(()=>assertAnomaly(value));
 for(const field of Object.keys(value))assert.throws(()=>assertAnomaly({...value,[field]:' '}));
});
test('ordinary start cannot smuggle the shortage override',async()=>{
 await assert.rejects(proposeControlledAction(admin,'MES_PRODUCTION_START',{allowShortage:true}),/MES_PRODUCTION_FORCE_START/);
});
test('revoked permission stops confirmation before any MES or database write',async()=>{
 const pending={id:'proposal',tool:'MES_PRODUCTION_REOPEN',status:'proposed',payload_summary:{}};
 let calls=0;
 const chain={select(){return this;},eq(){return this;},async maybeSingle(){return {data:pending};}};
 const auth={...admin,productionPermissions:[code],scoped:{from:()=>chain,rpc:async(name)=>{calls++;assert.equal(name,'workspace_mes_production_permissions');return {data:[]};}}};
 await assert.rejects(decideControlledAction(auth,{decision:'confirm',proposalId:'proposal'}),/Permesso specifico/);assert.equal(calls,1);
});
test('read-only discovery exposes only eligible reopen preview and never writes',async()=>{
 const tools=productionEmergencyTools({...admin,scoped:{rpc:async()=>({data:[]})}});
 assert.equal(tools.MES_PRODUCTION_PERMISSIONS.effect,'read');assert.equal(tools.MES_PRODUCTION_REOPEN_PREVIEW,undefined);
 assert.deepEqual(await tools.MES_PRODUCTION_PERMISSIONS.execute(),[]);
});

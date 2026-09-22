import test from 'node:test';
import assert from 'node:assert/strict';
import { canOpenPlanningProduction, PLANNING_PRODUCTION_SCREEN } from './production-workbench-access.js';
for (const level of ['lettura','scrittura','amministrazione']) {
 test('planning accepts effective '+level+' screen access', async()=>{
  const calls=[];
  const admin={rpc:async(name,args)=>{calls.push([name,args]);return {data:level};}};
  assert.equal(await canOpenPlanningProduction(admin,'operator'),true);
  assert.deepEqual(calls,[['workspace_screen_level_for_user',{target_user_id:'operator',target_screen:PLANNING_PRODUCTION_SCREEN}]]);
 });
}
for (const level of ['nessuno',null,undefined,'unknown',true]) {
 test('planning denies unavailable or invalid level '+String(level),async()=>{
  assert.equal(await canOpenPlanningProduction({rpc:async()=>({data:level})},'operator'),false);
 });
}
test('catalog permission lookup failure cannot open MES',async()=>{
 await assert.rejects(canOpenPlanningProduction({rpc:async()=>({error:{message:'offline'}})},'operator'),{status:503});
});

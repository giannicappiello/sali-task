import test from 'node:test';import assert from 'node:assert/strict';
import {packagingDepartmentAccess,packagingSession} from './packaging-access.js';
import {costSession} from './production-action-session.js';
import {canReadProductionSpecification} from './production-specification-access.js';
import {handlePackagingActions} from './packaging-actions.js';
import {handlePackagingSheet} from './packaging-sheet.js';
function fixture({department='Confezionamento',additional=false,active=true,deny=false,departmentActive=true,scope={mode:'team'},error=null}={}) {
 const admin={auth:{getUser:async()=>({data:{user:{id:'auth'}}})},rpc:async name=>({data:name==='workspace_data_scope'?scope:name==='workspace_area_access_codes'?[]:'nessuno'}),from(table){
  const data=table==='utenti'?{id:'employee',attivo:active,reparto_id:additional?null:'dept'}:table==='utenti_reparti'?(additional?[{reparto_id:'dept'}]:[]):table==='reparti'?[{nome:department,attivo:departmentActive}]:table==='workspace_eccezioni_utente'?(deny?[{decisione:'nega'}]:[]):[];
  const q={select(){return q},eq(){return q},in(){return q},maybeSingle:async()=>({data,error}),then(resolve,reject){return Promise.resolve({data,error}).then(resolve,reject)}};return q;
 }};return {admin,clientFactory:()=>admin};
}
const req={headers:{authorization:'Bearer valid'}};
test('primary and additional active packaging memberships grant all popup operations without general production rights',async()=>{
 for(const additional of [false,true]) {
  const f=fixture({additional});assert.equal(await packagingDepartmentAccess(f.admin,'employee'),true);
  const authorize=(r,s,w)=>packagingSession(r,s,w,f);
  await assert.rejects(costSession(req,'progremes.Produzione',true,f),{status:403});
  for(const operation of ['thermal-read','thermal-print','start-context','start']) {
   const result=await handlePackagingActions(req,{productionOrderId:1,productionId:2,resourceCode:'F03',operation,labelCount:1,piecesPerBox:2},{authorize,clientFactory:()=>({packagingActions:async input=>{assert.equal(input.requestedBy,'employee');return {result:{started:operation==='start'}}}})});
   assert.equal(result.canWrite,true);
  }
  for(const operation of ['read','print']) assert.equal((await handlePackagingSheet(req,{productionOrderId:1,operation},{authorize,clientFactory:()=>({packagingSheet:async()=>({result:{sheet:{}}})})})).canPrint,true);
  assert.equal(await canReadProductionSpecification(f.admin,'employee','/specifications'),true);
  assert.equal(await canReadProductionSpecification(f.admin,'employee','/specifications/save'),false);
 }
});
test('revocation, other departments, explicit denials and database failures do not grant fallback',async()=>{
 for(const options of [{department:'Miscelazione'},{department:'Produzione'},{active:false},{deny:true},{departmentActive:false}]) {
  const f=fixture(options);assert.equal(await packagingDepartmentAccess(f.admin,'employee'),false);
  await assert.rejects(packagingSession(req,'progremes.Produzione',true,f),{status:403});
 }
 await assert.rejects(packagingDepartmentAccess(fixture({error:new Error('db unavailable')}).admin,'employee'),/db unavailable/);
});
test('customer scopes cannot call MES even with packaging membership',async()=>{
 const f=fixture({scope:{mode:'cliente',customer_codes:['C1']}});let called=false;
 await assert.rejects(handlePackagingActions(req,{productionOrderId:1,operation:'thermal-read'},{authorize:(r,s,w)=>packagingSession(r,s,w,f),clientFactory:()=>{called=true;throw Error('unexpected')}}),{status:403});assert.equal(called,false);
});

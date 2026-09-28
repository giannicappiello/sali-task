import test from 'node:test';
import assert from 'node:assert/strict';
import {costSession} from './production-action-session.js';

const req={headers:{authorization:'Bearer valid'}};
function fixture({isAdmin=true,active=true,level='nessuno',planning='amministrazione',rpcError=null}={}) {
 const calls=[];
 const client={auth:{getUser:async()=>({data:{user:{id:'auth-id'}}})},from(){
  const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:'profile-id',attivo:active}})};return q;
 },async rpc(name,args){
  calls.push({name,args});
  if(name==='workspace_data_scope')return {data:{mode:'tutti'}};
  if(name==='workspace_user_is_admin')return {data:isAdmin,error:rpcError};
  return {data:args.target_screen==='progremes.PlanningProduction'?planning:level};
 }};
 return {clientFactory:()=>client,calls};
}
test('administrator opens and prints both sheets through active planning permission',async()=>{
 for(const screen of ['progremes.Produzione','progremes.OperatoreProduzione'])for(const write of [false,true]) {
  const f=fixture();assert.equal((await costSession(req,screen,write,f)).canWrite,true);
  assert.deepEqual(f.calls.find(c=>c.name==='workspace_user_is_admin').args,{target_auth_user_id:'auth-id'});
 }
});
test('non-admin and disabled planning cannot gain operational permissions',async()=>{
 for(const options of [{isAdmin:false},{planning:'nessuno'},{planning:'scrittura'}])
  await assert.rejects(costSession(req,'progremes.Produzione',true,fixture(options)),{status:403});
});
test('unrelated screens and inactive profiles remain denied',async()=>{
 for(const [screen,options] of [['progremes.Costi',{}],['progremes.Produzione',{active:false}]]) {
  const f=fixture(options);await assert.rejects(costSession(req,screen,true,f),{status:403});
  assert.equal(f.calls.some(c=>c.name==='workspace_user_is_admin'),false);
 }
});
test('operator read access is not promoted to write and auth failures fail closed',async()=>{
 const f=fixture({isAdmin:false,level:'lettura'});
 assert.equal((await costSession(req,'progremes.Produzione',false,f)).canWrite,false);
 await assert.rejects(costSession(req,'progremes.Produzione',true,f),{status:403});
 await assert.rejects(costSession({headers:{}},'progremes.Produzione',false,f),{status:401});
 await assert.rejects(costSession(req,'progremes.Produzione',true,fixture({rpcError:new Error('unavailable')})),/unavailable/);
});

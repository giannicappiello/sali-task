import process from 'node:process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { issueProgremesTicket } from './progremes-sso.js';
import { requestProgremesNavigation, rememberProgremesSession, forgetProgremesSession } from '../src/pages/ProgreMes/progremesWindow.js';

function fixture({level='amministrazione', route='/produzione/storico'}={}) {
 const writes=[];
 const admin={auth:{getUser:async()=>({data:{user:{id:'auth-maria'}}})},
  rpc:async(name)=> name==='workspace_user_is_admin' ? {data:false} : name==='workspace_progremes_screen_levels_for_user' ? {data:{'progremes.StoricoProduzioni':level}} : assert.fail(name),
  from(table){
   assert.notEqual(table,'progremes_reparti_moduli');
   const q={select(){return q;},eq(){return q;},in(){return q;},
    single:async()=>({data:{ultima_esecuzione:new Date().toISOString()}}),
    maybeSingle:async()=>({data:table==='utenti'?{id:'maria',email:'fixture@example.invalid',attivo:true}:{metadati:{external_module_code:'StoricoProduzioni',external_route:route}}}),
    insert:async(record)=>{writes.push(record);return {error:null};},
    then(resolve,reject){return Promise.resolve({data:table==='workspace_moduli_schermate'?[{modulo_codice:'produzione',schermata_codice:'progremes.StoricoProduzioni'}]:[{codice:'produzione'}]}).then(resolve,reject);}};
   return q;
  }};
 return {admin,writes};
}
const req={headers:{authorization:'Bearer fixture'}};
test('Maria opens an authorized MES screen without legacy department grants; navigation creates no ticket',async()=>{
 const old=process.env.PROGREMES_URL;process.env.PROGREMES_URL='https://mes.example';
 try {
  const {admin,writes}=fixture();
  const body={screenCode:'progremes.StoricoProduzioni',context:{odpId:'42'}};
  const initial=await issueProgremesTicket(req,body,{admin});
  assert.equal(new URL(initial.url).pathname,'/Account/WorkspaceSso');
  assert.equal(writes.length,1);assert.equal(writes[0].percorso_destinazione,'/produzione/storico?odpId=42');
  const next=await issueProgremesTicket(req,body,{admin,navigationOnly:true});
  assert.equal(next.url,'https://mes.example/produzione/storico?odpId=42');assert.equal(writes.length,1);
 } finally {if(old===undefined)delete process.env.PROGREMES_URL;else process.env.PROGREMES_URL=old;}
});
test('both SSO and same-window navigation reject a Workspace screen denial',async()=>{
 for(const navigationOnly of [false,true]){
  const {admin,writes}=fixture({level:'nessuno'});
  await assert.rejects(issueProgremesTicket(req,{screenCode:'progremes.StoricoProduzioni'},{admin,navigationOnly}),{status:403});
  assert.equal(writes.length,0);
 }
});
test('navigation rejects an external destination hidden in a catalog path',async()=>{
 const old=process.env.PROGREMES_URL;process.env.PROGREMES_URL='https://mes.example';
 try{
  const {admin}=fixture({route:'/\\evil.example/path'});
  await assert.rejects(issueProgremesTicket(req,{screenCode:'progremes.StoricoProduzioni'},{admin,navigationOnly:true}),{status:400});
 }finally{if(old===undefined)delete process.env.PROGREMES_URL;else process.env.PROGREMES_URL=old;}
});
test('confirmed MES session navigates directly; a different user or authorization revision renews SSO',async()=>{
 const actions=[];
 const fetcher=async(_path,options)=>{actions.push(JSON.parse(options.body));return {ok:true,json:async()=>({url:'https://mes.example/produzione/storico'})};};
 forgetProgremesSession();
 try{
  await requestProgremesNavigation('token',{sessionKey:'maria:1',screenCode:'progremes.StoricoProduzioni',fetcher});
  rememberProgremesSession('maria:1');
  await requestProgremesNavigation('token',{sessionKey:'maria:1',screenCode:'progremes.MonitoraggioTempi',fetcher});
  await requestProgremesNavigation('token',{sessionKey:'maria:2',screenCode:'progremes.MonitoraggioTempi',fetcher});
  await requestProgremesNavigation('token',{sessionKey:'other:1',screenCode:'progremes.MonitoraggioTempi',fetcher});
  forgetProgremesSession();
  await requestProgremesNavigation('token',{sessionKey:'maria:1',screenCode:'progremes.StoricoProduzioni',fetcher});
  assert.deepEqual(actions.map(row=>row.action),['progremes_sso','progremes_navigation','progremes_sso','progremes_sso','progremes_sso']);
  assert.equal(actions[1].screenCode,'progremes.MonitoraggioTempi');
 }finally{forgetProgremesSession();}
});

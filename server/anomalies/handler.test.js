import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAnomalies} from './handler.js';
const runId='11111111-1111-4111-8111-111111111111';
const makeAuth=()=>({profile:{id:'actor',ruoli:{amministratore_workspace:true}},capabilities:{internal_data:true,role_ai_level:'conferma',allowed_modules:['anomalie','progremes','magazzino']},scoped:{from(){const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:{id:runId}})};return q;}}});
const request={method:'POST',query:{action:'recover_delivery'},body:{run_id:runId}};
async function invoke(auth,req=request){let status=200,result,called=false;await handleAnomalies(req,{setHeader(){},status(n){status=n;return this;},json(x){result=x;return x;}},{authorize:async()=>auth,admin:()=>({test:true}),recover:async(db,args)=>{called=true;assert.equal(db.test,true);assert.deepEqual(args,{runId,ownerId:'actor'});return {status:'recovery'};}});return {status,result,called};}
test('admin recovery uses existing personal identity and exact run only',async()=>{const r=await invoke(makeAuth());assert.equal(r.status,200);assert.equal(r.called,true);});
test('recovery rejects nonadmin, missing role/source entitlement, invisible run and arbitrary request fields',async()=>{
 for(const mutate of [a=>a.profile.ruoli.amministratore_workspace=false,a=>a.capabilities.role_ai_level='lettura',a=>a.capabilities.allowed_modules=['anomalie','progremes'],a=>a.scoped.from=()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null})})]){const auth=makeAuth();mutate(auth);const r=await invoke(auth);assert.equal(r.status,403);assert.equal(r.called,false);}
 for(const body of [{run_id:'wrong'},{run_id:runId,recipients:['outside@example.test']}]){const r=await invoke(makeAuth(),{...request,body});assert.equal(r.called,false);assert.notEqual(r.status,200);}
});

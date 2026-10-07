import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedExecution, executeRequestedAction } from './operational-execution.js';
const auth={profile:{ruoli:{}},capabilities:{role_ai_level:'conferma'}};
test('only direct, scoped operational commands authorize execution',()=>{
 assert.equal(requestedExecution(auth,'Sposta questa produzione a domani','MES_PLAN_APPLY'),true);
 assert.equal(requestedExecution(auth,'Avvia questa produzione','MES_PRODUCTION_START'),true);
 assert.equal(requestedExecution(auth,'Modifica il lotto 123','LOT_OVERRIDE'),true);
 for(const prompt of ['Analizza come spostare la produzione','Sposta la produzione, non modificare nulla','Mostra una simulazione del planning','Sposta questa produzione']) {
   assert.equal(requestedExecution(auth,prompt,'ACCESS_ROLE_UPDATE'),false);
 }
 assert.equal(requestedExecution(auth,'Sposta questa produzione','MES_PRODUCTION_START'),false);
 assert.equal(requestedExecution(auth,'Come posso avviare questa produzione?','MES_PRODUCTION_START'),false);
 assert.equal(requestedExecution({...auth,capabilities:{role_ai_level:'bozza'}},'Sposta questa produzione','MES_PLAN_APPLY'),false);
});
test('requested action uses the existing permission, audit and idempotent confirmation path',async()=>{
 let decisions=0;
 const dependencies={propose:async()=>({controlledAction:{id:'action',state:'proposed'}}),decide:async(a,b)=>{assert.equal(b.proposalId,'action');decisions++;return {controlledAction:{state:'executed'}};}};
 const result=await executeRequestedAction(auth,'Sposta questa produzione','MES_PLAN_APPLY',{}, {},dependencies);
 assert.equal(result.changed,true);assert.equal(decisions,1);
 await executeRequestedAction(auth,'Analizza il planning','MES_PLAN_APPLY',{}, {},dependencies);
 assert.equal(decisions,1);
});
test('pending print/start never becomes successful and existing actions are not reapplied',async()=>{
 const result=await executeRequestedAction(auth,'Avvia questa produzione','MES_PRODUCTION_START',{}, {},
 {propose:async()=>({controlledAction:{id:'x',state:'proposed'}}),decide:async()=>({controlledAction:{state:'confirmed'}})});
 assert.equal(result.changed,false);assert.equal(result.pending,true);
 await executeRequestedAction(auth,'Sposta questa produzione','MES_PLAN_APPLY',{}, {},
 {propose:async()=>({controlledAction:{id:'x',state:'executed'}}),decide:async()=>assert.fail('Already executed')});
});


test('shortage execution needs an explicit choice in the current request',async()=>{
 let decisions=0;
 const dependencies={propose:async()=>({controlledAction:{id:'action',state:'proposed'}}),decide:async()=>{decisions++;return {controlledAction:{state:'confirmed'}};}};
 const result=await executeRequestedAction(auth,'Avvia questa produzione','MES_PRODUCTION_START',{allowShortage:true},{},dependencies);
 assert.equal(result.needsChoice,true);assert.equal(decisions,0);
 await executeRequestedAction(auth,'Avvia questa produzione anche con materiali mancanti','MES_PRODUCTION_START',{allowShortage:true},{},dependencies);
 assert.equal(decisions,1);
});


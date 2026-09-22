import test from 'node:test';
import assert from 'node:assert/strict';
import { getAuthorizedProgremesCodes } from './progremes-sso.js';
const noQueries={from(){throw Error('Unexpected legacy department query');}};
test('independent planning assignment does not grant other MES modules',async()=>{
 const codes=await getAuthorizedProgremesCodes(noQueries,{isAdmin:false,productionHubAllowed:false,planningProductionAllowed:true});
 assert.deepEqual([...codes],['PlanningProduction']);
});
test('no assignment grants no MES module',async()=>{
 const codes=await getAuthorizedProgremesCodes(noQueries,{isAdmin:false,productionHubAllowed:false,planningProductionAllowed:false});
 assert.equal(codes.size,0);
});
test('a legacy department assignment cannot override effective denial of new planning screen',async()=>{
 const db={from(table){return {select(){return this;},eq:async()=>({data:[{reparto_id:'department'}]}),in:async()=>({data:[{modulo_codice:'PlanningProduction'},{modulo_codice:'Planning'}]})};}};
 const codes=await getAuthorizedProgremesCodes(db,{isAdmin:false,productionHubAllowed:true,planningProductionAllowed:false,profile:{id:'user',reparto_id:'department'}});
 assert.deepEqual([...codes],['Planning']);
});

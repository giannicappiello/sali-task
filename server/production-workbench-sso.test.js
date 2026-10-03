import test from 'node:test';
import assert from 'node:assert/strict';
import { getProgremesScreenLevels, isProgremesScreenAuthorized } from './progremes-sso.js';
const noQueries={from(){throw Error('Unexpected legacy department query');},rpc:async()=>({data:{'progremes.PlanningProduction':'lettura'}})};
test('independent planning assignment does not grant other MES modules',async()=>{
 const levels=await getProgremesScreenLevels(noQueries,'user');
 assert.equal(isProgremesScreenAuthorized(levels,'progremes.PlanningProduction'),true);
 assert.equal(isProgremesScreenAuthorized(levels,'progremes.Planning'),false);
});
test('no assignment grants no MES module',async()=>{
 const levels=await getProgremesScreenLevels({rpc:async()=>({data:{}})},'user');
 assert.equal(isProgremesScreenAuthorized(levels,'progremes.PlanningProduction'),false);
});
test('a legacy department assignment cannot override effective denial of new planning screen',async()=>{
 const db={...noQueries,rpc:async()=>({data:{'progremes.PlanningProduction':'nessuno','progremes.Planning':'lettura'}})};
 const levels=await getProgremesScreenLevels(db,'user');
 assert.equal(isProgremesScreenAuthorized(levels,'progremes.PlanningProduction'),false);
 assert.equal(isProgremesScreenAuthorized(levels,'progremes.Planning'),true);
});

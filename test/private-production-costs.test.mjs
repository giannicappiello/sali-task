import test from 'node:test';import assert from 'node:assert/strict';
import {privateProductionRecord as project,privateProductionSummary as summary} from '../src/features/production-costs/private-report.js';
const base={id:1,plannedObjective:0,quantity:100,goodQuantity:50,commercial:{octRevenue:200},actualTotal:120,plannedTotal:999,baseline:{secret:true},phases:[{id:1,personnel:[{name:'hidden'}],actualHours:2,plannedHours:88}]};
test('compares actual costs with OCT value of worked quantity',()=>{const r=project(base);assert.equal(r.workedOct,100);assert.equal(r.excess,20);assert.ok(r.detail);assert.equal(JSON.stringify(r).includes('planned'),false);assert.equal(JSON.stringify(r).includes('secret'),false);assert.equal(JSON.stringify(r).includes('hidden'),false);});
test('no detail for equal, lower or unavailable costs and OCT',()=>{for(const patch of [{actualTotal:100},{actualTotal:90},{actualTotal:null},{commercial:{octRevenue:null}},{commercial:{octRevenue:200,octPartial:true}},{goodQuantity:0}]){const r=project({...base,...patch});assert.equal(r.excess,null);assert.equal(r.detail,undefined);}});
test('overall excess is net overall difference, not sum of positive rows',()=>{const a=project(base),b=project({...base,id:2,actualTotal:70});assert.equal(summary([a,b]).excess,null);assert.equal(summary([a]).excess,20);assert.equal(summary([a,project({...base,actualTotal:null})]).excess,20);});
test('overproduction cannot increase the agreed OCT value',()=>assert.equal(project({...base,goodQuantity:150}).workedOct,200));

test('OC92 available partial costs expose excess and detail',()=>{const r=project({...base,quantity:100,goodQuantity:100,actualTotal:null,actualLabor:17119.58,commercial:{octRevenue:12937.50}});assert.equal(r.actualTotal,17119.58);assert.equal(r.excess,4182.08);assert.equal(r.actualPartial,true);assert.ok(r.detail);assert.equal(summary([r]).excess,4182.08);assert.equal(summary([r]).actualPartial,true);assert.equal(JSON.stringify(r).includes('planned'),false);});
test('partial costs below OCT do not create an excess',()=>{const r=project({...base,actualTotal:null,actualLabor:90});assert.equal(r.actualPartial,true);assert.equal(r.excess,null);assert.equal(r.detail,undefined);});

test("missing OCT costs are excluded from comparison and itemized",()=>{const valid=project(base),missing=project({...base,id:2,actualTotal:999,commercial:{octRevenue:null,octReasons:["Riga assente"]}});const result=summary([valid,missing]);assert.equal(result.excess,20);assert.equal(result.excludedCost,999);assert.equal(result.excluded[0].octReasons[0],"OC non disponibile o non confrontabile.");assert.equal(result.comparableCount,1);});

test("STATION objective increases comparison total once",()=>{const r=project({...base,plannedObjective:25});assert.equal(r.comparisonTotal,145);assert.equal(r.excess,45);assert.equal(summary([r]).excess,45);});

test("private projection includes objective in costs without exposing internal amounts",()=>{const r=project({...base,closed:true,plannedObjective:25,phases:[{id:1,machineId:1,phase:"Semilavorato",actualTurns:2}]});assert.equal(r.actualTotal,145);assert.equal(r.comparisonTotal,145);assert.equal(r.excess,45);assert.equal(r.stationObjective,undefined);assert.equal(r.realGainPerShift,undefined);assert.equal(r.detail.costs,undefined);assert.equal(JSON.stringify(r).includes('Objective'),false);});
test("unmatched totals include objective and positive overall excess is the difference of comparable totals",()=>{const a=project({...base,plannedObjective:25}),b=project({...base,id:2,actualTotal:70,plannedObjective:10}),c=project({...base,id:3,actualTotal:50,plannedObjective:15,commercial:{octRevenue:null}});const result=summary([a,b,c]);assert.equal(result.excess,25);assert.equal(result.excludedCost,65);});

test('private references and conclusion survive legacy OC records without leaking diagnostics',()=>{
 const r=project({...base,orderNumber:'OC/2/250',customerCode:'501.00995',commercial:{octRevenue:null,octReasons:['STATION objective secret']},works:[{end:'2026-08-01T12:00:00Z',state:'Terminato'}]});
 assert.deepEqual(r.octReferences,['OC/2/250']);assert.equal(r.isSali,true);assert.equal(r.concludedAt,'2026-08-01T12:00:00Z');assert.equal(JSON.stringify(r).includes('secret'),false);
});
test('private invoice references retain net amounts and hide underlying invoice payloads',()=>{
 const r=project({...base,commercial:{octRevenue:200,invoiceRevenue:140,invoices:[{document:{sigla:'FT',serie:1,numero:42,secret:'hidden'}}]}});
 assert.equal(r.invoiceValue,140);assert.deepEqual(r.invoiceReferences,['FT 1/42']);assert.equal(JSON.stringify(r).includes('hidden'),false);
});

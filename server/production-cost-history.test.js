import test from "node:test";
import assert from "node:assert/strict";
import { applicableConfiguration, historicalConsumption, legacyOrderRevenue } from "../src/features/production-costs/history.js";
import { productionTurns } from "../src/features/production-costs/turns.js";
import { calculateRecord, defaultSettings } from "../src/features/production-costs/cost-engine.js";

const settings={...defaultSettings(),laborHourly:20,mixingOperatorsCount:3,shifts:[{name:"Turno 1",start:"09:00",end:"16:00",days:[1,2,3,4,5],breakMinutes:0}]};
const run=(end,extra={})=>calculateRecord({date:"2026-09-07",quantity:100,unit:"KG",works:[{id:1,machineId:1,phase:"Semilavorato",state:"Terminato",start:"2026-09-07T09:00:00",end,personnel:[]}],...extra},{settings},{} ,{},"2026-09-08T20:00:00");
test("user example: 9 to 17 is one shift plus one overtime hour",()=>{
 const r=run("2026-09-07T17:00:00");assert.equal(r.phases[0].actualTurns,1);assert.equal(r.phases[0].actualOvertimeHours,1);
 assert.equal(r.actualLabor,3*20*(1*8+1));assert.equal(r.phases[0].actualPersonHours,null);
});
test("user example: 9 to next day 11 is one and a half shifts, no overnight overtime",()=>{
 const r=run("2026-09-08T11:00:00");assert.equal(r.phases[0].actualTurns,1.5);assert.equal(r.phases[0].actualOvertimeHours,0);
 assert.equal(r.actualLabor,3*20*1.5*8);
});
test("a second configured shift is regular time, not overtime",()=>{
 const s={...settings,shifts:[...settings.shifts,{name:"Turno 2",start:"16:00",end:"23:00",days:[1],breakMinutes:0}]};
 const r=productionTurns("2026-09-07T09:00:00","2026-09-07T17:00:00",s);
 assert.equal(r.turns,1.5);assert.equal(r.overtimeHours,0);
});
test("half-shift rounding boundaries and zero duration",()=>{
 assert.equal(productionTurns("2026-09-07T09:00:00","2026-09-07T12:30:00",settings).turns,.5);
 assert.equal(productionTurns("2026-09-07T09:00:00","2026-09-07T12:31:00",settings).turns,1);
 assert.equal(productionTurns("2026-09-07T09:00:00","2026-09-07T09:00:00",settings).turns,0);
});
test("weekends and overnight shifts respect the configured calendar",()=>{
 assert.equal(productionTurns("2026-09-04T09:00:00","2026-09-07T11:00:00",settings).turns,1.5);
 const r=productionTurns("2026-09-07T22:00:00","2026-09-08T07:00:00",{...settings,shifts:[{start:"22:00",end:"06:00",days:[1],breakMinutes:0}]});
 assert.equal(r.turns,1);assert.equal(r.overtimeHours,1);
});
test("a missing mixing headcount never falls back to assigned personnel",()=>{
 const r=calculateRecord({works:[{id:1,phase:"Semilavorato",state:"Terminato",start:"2026-09-07T09:00:00",end:"2026-09-07T16:00:00",personnel:[{start:"2026-09-07T09:00:00",end:"2026-09-07T16:00:00"}]}]},{settings:{...settings,mixingOperatorsCount:null}});
 assert.equal(r.actualLabor,null);assert.equal(r.phases[0].actualPersonHours,7);
});
test("latest applicable retroactive configuration ignores reconstruction timestamp",()=>{
 const e={date:"2026-02-02",historicalBaseline:{recoveredAt:"2026-09-13"}};
 assert.equal(applicableConfiguration(e,[{id:"future",effective_from:"2026-09-13"},{id:"old",effective_from:"2026-01-01",created_at:"2026-09-13T08:00:00"},{id:"new",effective_from:"2026-01-01",created_at:"2026-09-13T09:00:00"}]).id,"new");
});
test("only issued historical materials become reconstructed consumption",()=>{
 const e={historicalMaterials:[{code:"A",quantity:10,currentUnitCost:2,withdrawnAt:"2026-02-02"},{code:"B",quantity:20,currentUnitCost:8,withdrawnAt:null}]};
 assert.equal(historicalConsumption(e).length,1);
 const r=run("2026-09-07T16:00:00",e);assert.equal(r.actualMaterialCost,20);assert.equal(r.baseline,undefined);assert.equal(r.bulkSl,undefined);
 assert.equal(r.reconstructed,true);assert.equal(r.actualTotal,null);assert.equal(r.actualKnownSubtotal,500);
});
test("confirmed SL always takes precedence over current-cost reconstruction",()=>{
 const r=run("2026-09-07T16:00:00",{bulkSl:[{materials:[{code:"A",quantity:10,unitCost:5}]}],historicalMaterials:[{code:"A",quantity:10,currentUnitCost:999,withdrawnAt:"2026-02-02"}]});
 assert.equal(r.actualMaterialCost,50);assert.equal(r.recoveredConsumption.length,0);
});
test("packaging recovery uses consumed commitments only and never replaces an SL",()=>{
 const historicalProductConsumption=[
  {code:"PK1",kind:"Packaging",quantity:10,currentUnitCost:2,consumedAt:"2026-09-07"},
  {code:"PK2",kind:"Packaging",quantity:100,currentUnitCost:20,consumedAt:null},
  {code:"FP1",kind:"Bulk",quantity:5,currentUnitCost:100,consumedAt:"2026-09-07"}
 ];
 const evidence={historicalProductConsumption,works:[{id:2,phase:"Confezionamento",state:"Terminato",start:"2026-09-07T09:00:00",end:"2026-09-07T16:00:00",personnel:[]}]};
 const r=calculateRecord(evidence,{settings});
 assert.equal(r.actualPackagingCost,20);assert.equal(r.recoveredProducts.length,2);
 assert.equal(r.unitCost,null);assert.equal(r.reconstructed,true);
 const confirmed=calculateRecord({...evidence,productSl:[{materials:[{code:"FP1",quantity:5,unitCost:3},{code:"PK1",quantity:10,unitCost:4}]}]},{settings});
 assert.equal(confirmed.actualPackagingCost,40);assert.equal(confirmed.recoveredProducts.length,0);
});
test("legacy OCT revenue requires exact line, article, unit and non-overallocated quantities",()=>{
 const e={quantity:50,articleCode:"FP1",unit:"KG",sourceOrder:{mesLineId:10,articleCode:"FP1",unit:"KG",quantity:100,lineValue:600}};
 assert.equal(legacyOrderRevenue(e,[e]),300);
 assert.equal(legacyOrderRevenue({...e,unit:"PZ"},[e]),null);
 assert.equal(legacyOrderRevenue(e,[e,{...e,quantity:60}]),null);
});

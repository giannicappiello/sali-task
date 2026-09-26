import test from "node:test";
import assert from "node:assert/strict";
import {recoverFormulaLinks} from "./production-formula-links.js";
import {forecastOperations} from "../src/features/production-costs/planned-timing.js";
const timing=()=>({formulaVersionId:824,productionHours:16,phaseMinutes:0,packagingMinutes:0,source:"Formula congelata",operations:[],calendar:{shifts:[{start:"07:30",end:"16:30",days:[1,2,3,4,5]}],closures:[]}});
const broken=()=>({id:5316,date:"2026-09-16",unit:"KG",quantity:3000,baseline:{capturedAt:"2026-09-16",quantity:3000,plannedTiming:timing()},works:[{id:4088,machineId:12,phase:"Semilavorato",state:"Terminato",goodQuantity:1,start:"2026-09-18T16:09:00",end:"2026-09-18T16:12:00"}]});
const catalog=()=>({id:99,plannedTiming:{operations:[{impiantoId:12,maximumCapacity:10000,speed:0,minimumOperators:1}]}});
test("empty frozen timing gains correct formula-work link without actual time/quantity or baseline changes",()=>{
 const e=broken(),before=structuredClone(e),r=recoverFormulaLinks([e,catalog()])[0];
 assert.deepEqual(e,before);assert.deepEqual(r.baseline,e.baseline);
 const rows=forecastOperations(r).operations;assert.equal(rows.length,1);assert.equal(rows[0].durationMinutes,1080);assert.equal(rows[0].quantity,3000);assert.equal(rows[0].impiantoId,12);
 assert.deepEqual(recoverFormulaLinks([r,catalog()])[0],r);
});
test("completed preventive row stays frozen even when current formula differs",()=>{
 const e=broken();e.baseline.plannedTiming.operations=[{impiantoId:12,type:"Production",durationMinutes:120,lotCount:1}];e.plannedTiming={...timing(),operations:[{impiantoId:12,type:"Production",durationMinutes:900,lotCount:1}]};
 assert.equal(recoverFormulaLinks([e,catalog()])[0].plannedTimingRecovery,undefined);
});
test("conflicting machine evidence and ambiguous splits stay explicit, not guessed",()=>{
 const e=broken(),other={id:100,plannedTiming:{operations:[{...catalog().plannedTiming.operations[0],maximumCapacity:500}]}};
 const r=recoverFormulaLinks([e,catalog(),other])[0];assert.equal(r.plannedTimingRecovery.recovered.length,0);assert.match(r.plannedTimingRecovery.unresolved[0].reason,/discordanti/);
 e.works.push({...e.works[0],id:2,machineId:13});const c=catalog();c.plannedTiming.operations.push({...c.plannedTiming.operations[0],impiantoId:13});
 assert.equal(recoverFormulaLinks([e,c])[0].plannedTimingRecovery.recovered.length,0);
});
test("missing cartoning speed/time is not borrowed from real duration",()=>{
 const e=broken();e.unit="PZ";e.works=[{machineId:21,phase:"Astucciatura",state:"Terminato",start:"2026-09-18T08:00:00",end:"2026-09-18T10:00:00"}];const c=catalog();c.plannedTiming.operations=[{impiantoId:21,maximumCapacity:0,speed:0,minimumOperators:1}];
 const r=recoverFormulaLinks([e,c])[0];assert.equal(r.plannedTimingRecovery.recovered.length,0);assert.match(r.plannedTimingRecovery.unresolved[0].reason,/velocità/);
});
test("current complete MES row can repair frozen missing row only for the same revision",()=>{
 const e=broken();e.plannedTiming={...timing(),operations:[{impiantoId:12,type:"Production",durationMinutes:1080,lotCount:1}]};
 assert.equal(recoverFormulaLinks([e])[0].plannedTimingRecovery.recovered.length,1);
 e.plannedTiming.formulaVersionId=999;assert.equal(recoverFormulaLinks([e])[0].plannedTimingRecovery.recovered.length,0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { calculateRecord, defaultSettings } from "../src/features/production-costs/cost-engine.js";
import { historicalConsumption } from "../src/features/production-costs/history.js";
import { displayRecord } from "../src/features/production-costs/cost-display.js";

const settings={...defaultSettings(),laborHourly:20,mixingOperatorsCount:1};
const works=[{id:1,machineId:7,phase:"Semilavorato",state:"Terminato",start:"2026-10-07T08:00:00",end:"2026-10-07T16:00:00",goodQuantity:1250,personnel:[]}];
const issue=(code,quantity,currentUnitCost,extra={})=>({code,quantity,currentUnitCost,withdrawnAt:"2026-10-07",...extra});
const evidence={works,historicalPackaging:{bulkCode:"FP516",packaging:[{code:"PK1",quantity:5000,unitCost:2}]},
 historicalMaterials:[issue("MP1",1250,.718529),issue("FP516",1250,.691)]};

test("existing mixed MES withdrawals value raw materials once and preserve source evidence",()=>{
 const before=structuredClone(evidence);
 const r=calculateRecord(evidence,{settings});
 assert.equal(r.actualMaterialSummary.value,898.16125);
 assert.equal(r.actualMaterialCost,898.16125);
 assert.deepEqual(r.recoveredConsumption.map(m=>m.code),["MP1"]);
 assert.deepEqual(r.materialVariances.map(m=>m.code),["MP1"]);
 assert.equal(displayRecord(r).actualMaterialCost,898.16125);
 assert.deepEqual(evidence,before);
});
test("bulk is recognized without conventional codes while other material costs are preserved",()=>{
 const e={historicalProductConsumption:[{code:"CUSTOM-BULK",kind:"Bulk"},{code:"BOX",kind:"Packaging"}],
 historicalMaterials:[issue("CUSTOM-BULK",1,100),issue("BOX",10,2),issue("FP-RAW-INGREDIENT",2,5)]};
 assert.deepEqual(historicalConsumption(e).map(m=>m.code),["BOX","FP-RAW-INGREDIENT"]);
});
test("product SL classification excludes the bulk transfer from material issues",()=>{
 const e={productSl:[{materials:[{code:"B",quantity:5,unitCost:10},{code:"P",quantity:10,unitCost:2}]}],
 historicalMaterials:[issue("R",3,4),issue("B",5,10),issue("P",10,2)]};
 assert.deepEqual(historicalConsumption(e).map(m=>m.code),["R","P"]);
});
test("mixed frozen SL is filtered for valuation without changing its original rows or prices",()=>{
 const e={...evidence,bulkSl:[{materials:[{code:"MP1",quantity:2,unitCost:7},{code:"FP516",quantity:1250,unitCost:.691}]}]};
 const r=calculateRecord(e,{settings});
 assert.equal(r.actualMaterialCost,14);
 assert.equal(r.recoveredConsumption.length,0);
 assert.equal(r.bulkSl[0].materials.length,2);
});
test("missing raw prices remain partial while known transferred bulk never fills their cost",()=>{
 const r=calculateRecord({...evidence,historicalMaterials:[issue("MP1",2,null),issue("MP2",3,4),issue("FP516",1250,.691)]},{settings});
 assert.equal(r.actualMaterialCost,null);
 assert.equal(r.actualMaterialSummary.value,12);
 assert.deepEqual(r.actualMaterialSummary.missingCodes,["MP1"]);
 assert.equal(displayRecord(r).costPartial.actualMaterialCost,true);
});
test("pure raw-material histories and unissued rows retain existing behavior",()=>{
 const e={historicalMaterials:[issue("A",3,4),issue("B",2,7,{withdrawnAt:null})]};
 assert.deepEqual(historicalConsumption(e).map(m=>m.code),["A"]);
});

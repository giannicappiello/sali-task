import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRecord } from '../src/features/production-costs/cost-engine.js';
import { materialBaseline } from '../src/features/production-costs/material-baseline.js';
const row=(quantity=75,unitCost=1.57,code='MP2025')=>({code,quantity,unitCost});
const actual={bulkSl:[{materials:[row()]}],works:[]};
const historicalBaseline={materials:[row(70,2)],materialsComplete:true};
const calc=e=>calculateRecord({...actual,...e},null);

test('missing formula is unknown, never zero or copied from SL',()=>{
 const r=calc({});assert.equal(r.materialVariances[0].plannedQuantity,null);
 assert.equal(r.materialVariances[0].actualQuantity,75);assert.equal(r.plannedMaterialCost,null);
 assert.equal(r.materialVariances[0].usageVariance,null);
});
test('empty saved snapshot is supplemented without mutation',()=>{
 const evidence={baseline:{capturedAt:'2026-01-01',materials:[],quantity:100},historicalBaseline};
 const before=JSON.stringify(evidence);const r=calc(evidence);
 assert.equal(r.materialVariances[0].plannedQuantity,70);assert.equal(r.plannedMaterialCost,140);
 assert.equal(r.materialVariances[0].usageVariance,10);assert.equal(r.reconstructed,true);
 assert.equal(JSON.stringify(evidence),before);assert.equal(r.baseline.capturedAt,'2026-01-01');
});
test('recorded quantities and prices retain priority; no current price overwrite',()=>{
 const r=calc({baseline:{materials:[row(60,3)]},historicalBaseline});
 assert.equal(r.materialVariances[0].plannedQuantity,60);assert.equal(r.materialVariances[0].plannedUnitCost,3);
 const unknown=calc({baseline:{materials:[row(60,null)]},historicalBaseline});
 assert.equal(unknown.materialVariances[0].plannedUnitCost,null);
});
test('partial snapshot fills only missing codes, normalizing whitespace and casing',()=>{
 const e={baseline:{materials:[row(10,4,' mp1 ')]},historicalBaseline:{materials:[row(20,9,'MP1'),row(30,2,'MP2')],materialsComplete:true},bulkSl:[{materials:[row(11,4,'MP1'),row(32,2,'mp2 ')]}]};
 const r=calc(e);assert.equal(r.materialVariances.length,2);assert.equal(r.plannedMaterialCost,100);
 assert.deepEqual(r.materialVariances.map(x=>x.plannedQuantity),[10,30]);
});
test('missing quantities remain unknown and cannot produce a zero total',()=>{
 const r=calc({baseline:{materials:[row(null)]}});
 assert.equal(r.materialVariances[0].plannedQuantity,null);assert.equal(r.plannedMaterialCost,null);
 const bothInvalid=materialBaseline({baseline:{materials:[row(null)]},historicalBaseline:{materials:[row(null)]}});
 assert.equal(bothInvalid.rows.length,1);assert.equal(bothInvalid.rows[0].quantity,null);
});
test('incomplete lot group is reconstructed once, not added to whole formula',()=>{
 const r=calc({baseline:{materials:[row(10),row(null)]},historicalBaseline});
 assert.equal(r.materialVariances[0].plannedQuantity,70);assert.equal(r.plannedMaterialCost,70*1.57);
 assert.equal(r.materialVariances[0].plannedUnitCost,1.57);
});
test('explicit zero quantity remains zero and is not overwritten',()=>{
 const r=calc({baseline:{materials:[row(0)]},historicalBaseline});
 assert.equal(r.materialVariances[0].plannedQuantity,0);assert.equal(r.plannedMaterialCost,0);
});
test('split lots and repeated formula components are summed by article',()=>{
 const r=calc({baseline:{materials:[row(20),row(30)]}});
 assert.equal(r.materialVariances[0].plannedQuantity,50);
});
test('zero for an extra SL material requires explicitly complete formula evidence',()=>{
 const base={baseline:{materials:[row(3,2,'OTHER')]}};
 assert.equal(calc(base).materialVariances.find(x=>x.code==='MP2025').plannedQuantity,null);
 base.baseline.materialsComplete=true;
 assert.equal(calc(base).materialVariances.find(x=>x.code==='MP2025').plannedQuantity,0);
});
test('reconstructed formula without prices gives known quantities but unknown euros',()=>{
 const r=calc({historicalBaseline:{materials:[row(70,null)]}});
 assert.equal(r.materialVariances[0].plannedQuantity,70);assert.equal(r.plannedMaterialCost,null);
 assert.equal(r.materialVariances[0].usageVariance,null);
});

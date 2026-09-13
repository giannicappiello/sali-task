import test from 'node:test';
import assert from 'node:assert/strict';
import { materialSummary,calculateRecord,allocateBulkCosts } from '../src/features/production-costs/cost-engine.js';
import { costRows,displayRecord } from '../src/features/production-costs/cost-display.js';
import { sumAvailable } from '../src/features/production-costs/available-costs.js';
const materials=[{code:'MP1',quantity:75,unitCost:1.57},{code:'MP2205',quantity:12009,unitCost:null}];
test('summary sums valued materials and identifies missing components',()=>{
 const s=materialSummary(materials);assert.equal(s.value,117.75);assert.equal(s.missingRows,1);assert.deepEqual(s.missingCodes,['MP2205']);
});
test('no available costs stays unknown, explicit zero is valid',()=>{
 assert.equal(materialSummary([]).value,null);assert.equal(materialSummary([{code:'A',quantity:10,unitCost:null}]).value,null);
 assert.equal(materialSummary([{code:'A',quantity:10,unitCost:0}]).value,0);
 assert.equal(materialSummary([{code:'A',quantity:null,unitCost:2}]).value,null);
});
test('partial material values feed totals and margins without overwriting complete accounting',()=>{
 const r=calculateRecord({quantity:15000,unit:'KG',baseline:{materials},bulkSl:[{materials}],works:[{id:1,phase:'Semilavorato',state:'Terminato',goodQuantity:15000,personnel:[]}]},null,{}, {octRevenue:1000,invoiceRevenue:1000,invoicedQuantity:15000});
 assert.equal(r.plannedMaterialCost,null);assert.equal(r.actualMaterialCost,null);
 assert.equal(r.plannedKnownSubtotal,117.75);assert.equal(r.actualKnownSubtotal,117.75);
 assert.equal(r.plannedTotal,null);assert.equal(r.actualTotal,null);assert.equal(r.plannedMargin,null);assert.equal(r.actualMargin,null);
 const display=displayRecord(r);assert.equal(display.plannedMargin,882.25);assert.equal(display.actualMargin,882.25);assert.equal(display.costPartial.actualMargin,true);
 const rows=costRows(r);for(const name of ['Materie prime','Totale costi']){
  const row=rows.find(x=>x.name===name);assert.equal(row.p,117.75);assert.equal(row.a,117.75);assert.equal(row.pp,true);assert.equal(row.ap,true);
 }
});
test('partial filling costs calculate price per piece and invoice margin on matched quantities',()=>{
 const r=calculateRecord({quantity:100,unit:'PZ',baseline:{packaging:materials},productSl:[{materials:[{code:'BULK',quantity:50},...materials]}],works:[{id:1,phase:'Confezionamento',state:'Terminato',goodQuantity:100,personnel:[]}]},null,{}, {octRevenue:500,invoiceRevenue:300,invoicedQuantity:50});
 const d=displayRecord(r);assert.equal(d.actualPackagingCost,117.75);assert.equal(d.unitCost,1.1775);assert.equal(d.actualMargin,241.125);assert.equal(d.costPartial.unitCost,true);
 assert.equal(d.directActualTotal,117.75);assert.equal(r.unitCost,null);
 const noQuantity=displayRecord({...r,invoicedQuantity:null});assert.equal(noQuantity.actualMargin,null);
});
test('available phase costs are retained even with missing other phases',()=>{
 const d=displayRecord({phases:[{phase:'Semilavorato',actualLabor:120,plannedLabor:80,actualWash:null},{phase:'Semilavorato',actualLabor:null,plannedLabor:null,actualWash:20}],actualLabor:null,plannedLabor:null,actualWash:null,plannedWash:null,actualTotal:null,plannedTotal:null});
 assert.equal(d.actualLabor,120);assert.equal(d.actualWash,20);assert.equal(d.actualTotal,140);assert.equal(d.plannedTotal,80);assert.equal(d.costPartial.actualTotal,true);
 assert.equal(sumAvailable([null,undefined]),null);assert.equal(sumAvailable([null,0,30]),30);
});
test('complete material totals remain complete and preserve existing accounting',()=>{
 const m=[materials[0]],r=calculateRecord({baseline:{materials:m},bulkSl:[{materials:m}],works:[]},null);
 const row=costRows(r).find(x=>x.name==='Materie prime');assert.equal(row.a,117.75);assert.equal(row.ap,false);
});
test('partial bulk allocation reaches filling unit costs without duplicate direct costs',()=>{
 const bulk=calculateRecord({id:1,lot:'L',unit:'KG',baseline:{materials,operations:[{type:'Production',impiantoId:1,quantity:100}]},bulkSl:[{materials}],works:[{id:1,machineId:1,phase:'Semilavorato',state:'Terminato',goodQuantity:100}]},null);
 const filling=calculateRecord({id:2,bulkLot:'L',unit:'PZ',baseline:{bulkQuantity:50,packaging:[{code:'P',quantity:100,unitCost:1}]},productSl:[{materials:[{code:'B',quantity:50},{code:'P',quantity:100,unitCost:1}]}],works:[{id:2,phase:'Confezionamento',state:'Terminato',goodQuantity:100}]},null);
 const resolved=allocateBulkCosts([bulk,filling])[1],d=displayRecord(resolved);
 assert.equal(resolved.commercial.bulkTransferCost,null);assert.equal(resolved.commercial.bulkTransferAvailable,58.875);
 assert.equal(d.productActualTotal,158.875);assert.equal(d.unitCost,1.58875);assert.equal(d.directActualTotal,100);assert.equal(d.costPartial.unitCost,true);
 const ambiguous=allocateBulkCosts([bulk,{...bulk,id:3},filling])[2];assert.equal(ambiguous.commercial.bulkTransferAvailable,undefined);
});

import test from "node:test";
import assert from "node:assert/strict";
import { calculateRecord, allocateBulkCosts, defaultSettings, scheduledHours, validateSettings, sumKnown, shiftDuration } from "../src/features/production-costs/cost-engine.js";
import { configurationFor, costSession } from "./production-costs.js";
import { PROGREMES_ALLOWED_RESOURCES, createProgremesClient } from "./progremes-readonly-client.js";

const settings={...defaultSettings(),laborHourly:20,mixingOperatorsCount:2,machines:[{id:1,code:"ST1",washCost:10,washMinutes:30,gainPerShift:100},{id:2,code:"FILL1",washCost:5,washMinutes:15,gainPerShift:""}]};
const config={id:"c1",effective_from:"2026-01-01",created_at:"2026-01-01",settings};
const operation=(machine=1,type="Production")=>({impiantoId:machine,type,start:"2026-09-07T08:00:00",end:"2026-09-07T10:00:00",operators:2});
const work=(id=1,machineId=1,phase="Semilavorato")=>({id,machineId,phase,state:"Terminato",start:"2026-09-07T08:00:00",end:"2026-09-07T10:00:00",goodQuantity:100,scrapQuantity:2,downtimeMinutes:0,personnel:[{id:1,start:"2026-09-07T08:00:00",end:"2026-09-07T10:00:00"},{id:2,start:"2026-09-07T08:00:00",end:"2026-09-07T10:00:00"}],losses:[]});
export const sampleEvidence={id:1,orderNumber:"RDP26",articleCode:"FP092Q",articleName:"Semilavorato Retinol Complex Crema Q10",customerCode:"501.001",customerName:"Cliente collaudo",unit:"KG",date:"2026-09-07",quantity:100,lot:"LOT1",bulkLot:"LOT1",
 baseline:{capturedAt:"2026-09-07",materials:[{code:"MP1",quantity:100,unitCost:2}],packaging:[],operations:[operation(),{...operation(),type:"Cleaning",operators:0}]},
 bulkSl:[{document:"SL 1/1",materials:[{code:"MP1",quantity:110,unitCost:3}]}],works:[work()],historicalMaterials:[],links:[]};
const adjustment={washes:[{productionId:1,count:1,minutes:30}]};
const calc=(e=sampleEvidence,c=config,a=adjustment,commercial={})=>calculateRecord(e,c,a,commercial,"2026-09-08T08:00:00");
test("unknown values never become zero totals",()=>{assert.equal(sumKnown([1,null]),null);assert.equal(sumKnown([]),null);assert.equal(sumKnown([0,0]),0);assert.equal(calc(sampleEvidence,null).actualTotal,null);});
test("original formula versus confirmed SL separates usage and price",()=>{const r=calc();assert.equal(r.plannedMaterialCost,200);assert.equal(r.actualMaterialCost,330);assert.equal(r.materialVariances[0].usageVariance,20);assert.equal(r.materialVariances[0].priceVariance,110);assert.equal(r.actualTotal,500);assert.equal(r.plannedTotal,370);});
test("station gain remains separate from production costs and revenue",()=>{const r=calc();assert.equal(r.plannedGain,50);assert.equal(r.actualGain,50);assert.equal(r.actualTotal,500);assert.equal(r.plannedRevenue,null);});
test("missing SL is unknown, not zero actual consumption",()=>{const r=calc({...sampleEvidence,bulkSl:null});assert.equal(r.actualMaterialCost,null);assert.equal(r.materialVariances[0].actualQuantity,null);assert.equal(r.materialVariances[0].usageVariance,null);});
test("unrecorded washes do not become zero",()=>{const r=calc(sampleEvidence,config,{});assert.equal(r.actualWash,null);assert.equal(r.actualTotal,null);});
test("zero confirmed washes is a valid actual",()=>{const r=calc(sampleEvidence,config,{washes:[{productionId:1,count:0,minutes:0}]});assert.equal(r.actualWash,0);assert.equal(r.actualTotal,490);});
test("weekend and holidays are excluded from planned shift hours",()=>{assert.equal(scheduledHours("2026-09-04T08:00:00","2026-09-07T16:00:00",settings),16);assert.equal(scheduledHours("2026-09-04T08:00:00","2026-09-07T16:00:00",{...settings,holidays:["2026-09-07"]}),8);});
test("overnight shifts and breaks",()=>{const s={...settings,shifts:[{name:"Notte",start:"22:00",end:"06:00",breakMinutes:30,days:[1]}]};assert.equal(shiftDuration(s.shifts[0]),7.5);assert.equal(scheduledHours("2026-09-07T22:00:00","2026-09-08T06:00:00",s),7.5);});
test("overlapping shifts rejected including midnight overlaps",()=>{assert.throws(()=>validateSettings({...settings,shifts:[{start:"22:00",end:"06:00",days:[1],breakMinutes:0},{start:"04:00",end:"08:00",days:[2],breakMinutes:0}]}),/sovrapporsi/);});
test("zero length shift and invalid prices rejected",()=>{assert.throws(()=>validateSettings({...settings,shifts:[{start:"08:00",end:"08:00",days:[1]}]}));assert.throws(()=>validateSettings({...settings,prices:[{articleCode:"FP",price:-1,unit:"KG"}]}));});
test("paused production keeps downtime outside net machine time",()=>{const r=calc({...sampleEvidence,works:[{...work(),end:null,state:"Sospeso",pausedAt:"2026-09-07T09:00:00",downtimeMinutes:30}]});assert.equal(r.phases[0].actualHours,0.5);assert.equal(r.closed,false);});
test("unstarted production does not accumulate elapsed hours",()=>{const r=calc({...sampleEvidence,works:[{...work(),state:"DaAvviare",start:"0001-01-01",end:null}]});assert.equal(r.phases[0].actualHours,null);});
test("historical baseline and cost prices remain explicitly missing",()=>{const r=calc({...sampleEvidence,baseline:null,bulkSl:null});assert.equal(r.historical,true);assert.equal(r.plannedTotal,null);assert.equal(r.actualTotal,null);});
test("configuration selection respects effective dates",()=>{assert.equal(configurationFor(sampleEvidence,[{...config,id:"future",effective_from:"2027-01-01"},config]).id,"c1");assert.equal(configurationFor(sampleEvidence,[{...config,effective_from:"2027-01-01"}]),null);});
test("OCT and invoice not summed; margin allocated to invoice quantity",()=>{const r=calc(sampleEvidence,config,adjustment,{octRevenue:1000,invoiceRevenue:600,invoicedQuantity:50});assert.equal(r.plannedRevenue,1000);assert.equal(r.actualRevenue,600);assert.equal(r.actualMargin,350);assert.equal(r.plannedMargin,630);});
test("invoiced quantity above produced quantity is not comparable",()=>{assert.equal(calc(sampleEvidence,config,adjustment,{invoiceRevenue:1000,invoicedQuantity:101}).actualMargin,null);});
test("specific estimated price takes precedence over generic",()=>{const r=calc(sampleEvidence,{...config,settings:{...settings,prices:[{articleCode:"FP092Q",unit:"KG",price:1},{articleCode:"FP092Q",unit:"KG",customerCode:"501.001",price:3}]} });assert.equal(r.plannedRevenue,300);});
test("OCT remains authoritative over configured estimate",()=>{const r=calc(sampleEvidence,{...config,settings:{...settings,prices:[{articleCode:"FP092Q",unit:"KG",price:1}]}},adjustment,{octRevenue:999});assert.equal(r.plannedRevenue,999);});
test("filling uses bulk cost once, plus packaging/labor/wash, divided by good pieces",()=>{
 const e={...sampleEvidence,id:2,unit:"PZ",lot:"FIN1",quantity:100,works:[work(2,2,"Confezionamento")],bulkSl:null,
 productSl:[{document:"SL 2",materials:[{code:"FP092Q",quantity:50,unitCost:999},{code:"PACK",quantity:100,unitCost:0.5}]}],
 baseline:{...sampleEvidence.baseline,materials:[],packaging:[{code:"PACK",quantity:100,unitCost:0.5}],operations:[operation(2,"Packaging")]}};
 const a={washes:[{productionId:2,count:0,minutes:0}]};
 const filling={...calc(e,config,a),audit:[{details:a}]},bulk={...calc(),audit:[{details:adjustment}]};
 const resolved=allocateBulkCosts([bulk,filling])[1];
 assert.equal(resolved.commercial.bulkTransferCost,250);assert.equal(resolved.productActualTotal,380);assert.equal(resolved.unitCost,3.8);
 assert.equal(resolved.directActualTotal,130);assert.equal(bulk.directActualTotal+resolved.directActualTotal,630);
});
test("cost evidence cannot be exposed by generic MES read-only proxy",()=>{assert(!PROGREMES_ALLOWED_RESOURCES.includes("production-cost-evidence"));assert(!PROGREMES_ALLOWED_RESOURCES.includes("production-cost-machines"));});
test("unauthenticated cost API is denied before database access",async()=>{await assert.rejects(()=>costSession({headers:{}},"produzione.consuntivi"),e=>e.status===401);});
test("MES cost evidence contract is validated",async()=>{const client=createProgremesClient({baseUrl:"https://example.test/api/workspace/v1/",secret:"test",fetchFn:async()=>new Response(JSON.stringify({page:1,pageSize:100,total:1,items:[{id:1}]})),logger:{error(){}}});await assert.rejects(()=>client.request("production-cost-evidence"),/Contratto/);});

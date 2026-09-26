import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { defaultSettings,calculateRecord,validateSettings } from "../src/features/production-costs/cost-engine.js";
import { defaultLaborRules, sameSettings } from "../src/features/production-costs/labor-rules.js";
import { applyCostProposal,costExamples } from "../src/features/production-costs/cost-proposals.js";
import { handleCostAI,approvedCostSettings,evaluateCostProposal } from "./ai/production-costs.js";
import { handleProductionCosts } from "./production-costs.js";
const base=()=>({...defaultSettings(),laborHourly:20,mixingOperatorsCount:3,shifts:[{name:"1",start:"09:00",end:"16:00",days:[1,2,3,4,5],breakMinutes:0}],machines:[{id:1,code:"ST1",type:"Miscelatore",washCost:0,washMinutes:0,gainPerWork:500},{id:2,code:"F1",type:"LineaVasi",washCost:0,washMinutes:0,gainPerWork:""}]});
const output=patch=>({answer:"Proposta da confermare",questions:[],readyForApproval:true,patch});
test("legacy settings preserve half shifts and independent exact filling hours",()=>{
 const e=costExamples(base());assert.equal(e.rows[0].actual,720);assert.equal(e.rows[1].planned,120);assert.equal(e.rows[1].actual,120);
 assert.equal(sameSettings(base(),base()),true);
});
test("AI changes are validated declarations, never arbitrary code or new machines",()=>{
 for(const patch of [{execute:"delete"},{station:{expression:"eval()"}},{machines:[{id:999,gainPerWork:10}]},{machines:[{id:2,gainPerWork:10}]},{laborHourly:-1},{station:{rounding:.3}},{station:{overtimeMultiplier:8}},{filling:{roundingMinutes:9}}])assert.throws(()=>applyCostProposal(base(),patch));
 const b=base(),candidate=applyCostProposal(b,{station:{overtimeMultiplier:1.25},machines:[{id:1,gainPerWork:800}]});
 assert.equal(candidate.machines[0].gainPerWork,800);assert.equal(b.machines[0].gainPerWork,500);assert.equal(candidate.laborRules.filling.roundingMinutes,0);
});
test("ambiguous and unsupported AI replies cannot be applied",()=>{
 assert.equal(evaluateCostProposal(base(),{...output({}),questions:["Quale tariffa?"],readyForApproval:false}).candidate,null);
 assert.equal(evaluateCostProposal(base(),output({station:{rounding:3}})).candidate,null);
});
test("station calendar hours and overtime multipliers use actual deterministic rules",()=>{
 const s=base();s.laborRules=defaultLaborRules();s.laborRules.station={basis:"scheduled_hours",rounding:0,overtimeMultiplier:1.25};
 const r=calculateRecord({works:[{id:1,machineId:1,phase:"Semilavorato",state:"Terminato",start:"2026-09-07T09:00:00",end:"2026-09-07T17:00:00",personnel:[]}]},{settings:s});
 assert.equal(r.actualLabor,3*20*(7+1.25));
 assert.equal(costExamples(s).rows[2].actual,r.actualLabor);
});
test("multiple STATIONs do not invent a revenue allocation for margin objectives",()=>{
 const settings=base();settings.machines.push({...settings.machines[0],id:3,code:"ST3"});
 const works=[1,3].map(id=>({id,machineId:id,phase:"Semilavorato",state:"Terminato",start:"2026-09-07T09:00:00",end:"2026-09-07T16:00:00",goodQuantity:100,personnel:[]}));
 const result=calculateRecord({quantity:100,unit:"KG",works},{settings},{},{octRevenue:1000,invoiceRevenue:1000,invoicedQuantity:100});
 assert.equal(result.plannedObjective,null);assert.equal(result.invoicedObjective,null);assert.equal(result.actualObjectiveVariance,null);
});
test("filling rounds per presence only when configured; never uses mixing headcount",()=>{
 const s=base();s.laborRules=defaultLaborRules();s.laborRules.filling.roundingMinutes=15;
 const r=calculateRecord({works:[{id:2,phase:"Confezionamento",state:"Terminato",start:"2026-09-07T09:00:00",end:"2026-09-07T10:01:00",personnel:[{start:"2026-09-07T09:00:00",end:"2026-09-07T10:01:00"},{start:"2026-09-07T09:00:00",end:"2026-09-07T10:01:00"}]}]},{settings:s});
 assert.equal(r.actualLabor,2*1.25*20);assert.equal(r.phases[0].actualPersonHours,2*(61/60));
});
test("filling planning basis and cleaning flag change forecast, not real presence",()=>{
 const s=base();s.laborRules=defaultLaborRules();s.laborRules.filling={plannedTime:"elapsed",includeCleaning:false,roundingMinutes:0};
 const r=calculateRecord({baseline:{operations:[{impiantoId:2,type:"Packaging",operators:2,start:"2026-09-07T15:00:00",end:"2026-09-07T17:00:00"},{impiantoId:2,type:"Cleaning",operators:2,start:"2026-09-07T17:00:00",end:"2026-09-07T18:00:00"}]},works:[]},{settings:s});
 assert.equal(r.plannedLabor,80);assert.equal(r.actualLabor,null);
 assert.throws(()=>validateSettings({...s,laborRules:{filling:{includeCleaning:"yes"}}}));
});
test("margin target is not revenue/cost, invoice target uses the same quantity as margin",()=>{
 const s=base(),r=calculateRecord({quantity:100,unit:"KG",baseline:{materials:[{code:"M",quantity:100,unitCost:1}],operations:[{type:"Production",impiantoId:1,operators:3,start:"2026-09-07T09:00:00",end:"2026-09-07T16:00:00"}]},bulkSl:[{materials:[{code:"M",quantity:100,unitCost:1}]}],works:[{id:1,machineId:1,phase:"Semilavorato",state:"Terminato",goodQuantity:100,start:"2026-09-07T09:00:00",end:"2026-09-07T16:00:00",personnel:[]}]},{settings:s},{washes:[{productionId:1,count:0,minutes:0}]},{octRevenue:1200,invoiceRevenue:600,invoicedQuantity:50});
 assert.equal(r.actualTotal,580);assert.equal(r.plannedMargin,620);assert.equal(r.actualMargin,310);assert.equal(r.plannedObjective,500);assert.equal(r.invoicedObjective,250);assert.equal(r.actualObjectiveVariance,60);
});

// In-memory repository double exercises the complete server proposal boundary.
function database(){
 const data=new Map(),writes=[];
 const db={data,writes,rpc:async()=>({data:{},error:null}),from(table){
  if(!data.has(table))data.set(table,[]);
  let action="select",payload,filters=[],count=false;
  const query={select(_fields,options){count=options?.count==="exact";return query;},eq(k,v){filters.push(r=>r[k]===v);return query;},gte(k,v){filters.push(r=>r[k]>=v);return query;},order(){return query;},limit(){return query;},insert(v){action="insert";payload=v;return query;},update(v){action="update";payload=v;return query;},single(){return run(true);},maybeSingle(){return run(true);},then(a,b){return run(false).then(a,b);}};
  async function run(single){let rows=data.get(table).filter(r=>filters.every(f=>f(r)));if(action!=="select")writes.push(table);if(action==="insert"){rows=[{id:randomUUID(),created_at:new Date().toISOString(),...payload}];data.get(table).push(...rows);}if(action==="update")rows.forEach(r=>Object.assign(r,payload));return {data:single?rows[0]||null:rows,count:count?rows.length:null,error:null};}
  return query;
 }};return db;
}
const owner=randomUUID(),other=randomUUID();
const authorize=async()=>({capabilities:{internal_data:true}});
test("proposal persists before generation, replay does not spend again, no configuration writes",async()=>{
 const admin=database(),id=randomUUID(),body={operation:"ai-propose",requestId:id,prompt:"Margine ST1 800",settings:base()};let calls=0;
 const generate=async()=>{calls++;assert.equal(admin.data.get("production_cost_ai_proposals")[0].id,id);return {output:output({machines:[{id:1,gainPerWork:800}]}),usage:{inputTokens:100,outputTokens:50}};};
 const result=await handleCostAI({},body,{admin,profile:{id:owner}},{authorize,generate});
 assert.equal(result.proposal.candidate.machines[0].gainPerWork,800);assert.equal(result.proposal.status,"complete");
 await handleCostAI({},body,{admin,profile:{id:owner}},{authorize,generate});assert.equal(calls,1);
 assert.equal(admin.writes.includes("production_cost_configurations"),false);
 const saved=await approvedCostSettings(admin,owner,{settings:result.proposal.candidate,proposalId:id,confirmProposal:true});assert.equal(saved.aiDefinition.proposalId,id);
 await assert.rejects(()=>approvedCostSettings(admin,other,{settings:result.proposal.candidate,proposalId:id,confirmProposal:true}),/disponibile/);
 await assert.rejects(()=>approvedCostSettings(admin,owner,{settings:result.proposal.candidate,proposalId:id}),/Confermare/);
 await assert.rejects(()=>approvedCostSettings(admin,owner,{settings:{...result.proposal.candidate,laborHourly:999},proposalId:id,confirmProposal:true}),/Confermare/);
});
test("AI errors preserve the request, never activate rules",async()=>{
 const admin=database(),id=randomUUID();await assert.rejects(()=>handleCostAI({},{operation:"ai-propose",requestId:id,prompt:"Prova",settings:base()},{admin,profile:{id:owner}},{authorize,generate:async()=>{throw new Error("upstream private detail");}}),/nessuna configurazione/i);
 const p=admin.data.get("production_cost_ai_proposals")[0];assert.equal(p.status,"error");assert.equal(p.error.includes("private"),false);assert.equal(admin.writes.includes("production_cost_configurations"),false);
});
test("AI entitlement and screen authentication are required",async()=>{
 await assert.rejects(()=>handleProductionCosts({headers:{}},{operation:"ai-propose"}),/Sessione mancante/);
 await assert.rejects(()=>handleCostAI({},{operation:"ai-history"},{admin:database(),profile:{id:owner}},{authorize:async()=>{throw new Error("Accesso AI non autorizzato");}}),/non autorizzato/);
});

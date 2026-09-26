import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculateRecord,defaultSettings,validateSettings } from "../src/features/production-costs/cost-engine.js";
import { fillingUnitLabor,activeFillingPolicy,withAdditionalFillingShifts,fillingHistorySummary } from "../src/features/production-costs/filling-history.js";
import { applyCostProposal,costExamples,proposalChanges } from "../src/features/production-costs/cost-proposals.js";
import { evaluateCostProposal,COST_SYSTEM_PROMPT,COST_PROPOSAL_SCHEMA } from "./ai/production-costs.js";
import { readFillingHistory } from "./production-filling-history.js";
import { handleProductionCosts } from "./production-costs.js";
import { createProgremesClient,PROGREMES_ALLOWED_RESOURCES } from "./progremes-readonly-client.js";
const settings=()=>({...defaultSettings(),laborHourly:40,laborRules:{filling:{basis:"historical_pieces"}},mixingOperatorsCount:2});
export const fillingFixtureHistory=()=>({generatedAt:"2026-09-11T15:00:00Z",asOfLocal:"2026-09-11T17:00:00",periodStart:"2026-09-07T09:00:00",periodEnd:"2026-09-10T16:30:00",completedWorks:2,completedPieces:3200,calendarShifts:4,productivity:800,packagingOperatorsCount:4,cartoningCompletedWorks:2,cartoningPieces:3200,cartoningWarning:null,error:null,works:[],calendar:{source:"MES",shifts:[{name:"MES",start:"07:30",end:"16:30",days:[1,2,3,4,5],breakMinutes:0}],closures:[],historyWarning:"Orari attuali retroattivi."}});
const work=(id=1,phase="Confezionamento",goodQuantity=500)=>({id,machineId:2,orderId:10,phase,unit:"PZ",goodQuantity,scrapQuantity:25,state:"Terminato",start:"2026-09-07T09:00:00",end:"2026-09-08T12:00:00",personnel:[]});
const evidence=()=>({id:10,unit:"PZ",quantity:1000,baseline:{quantity:1000,operations:[{type:"Packaging",impiantoId:2,start:"2026-09-07T09:00:00",end:"2026-09-08T12:00:00",operators:2}]},works:[work()]});
const calc=(e=evidence(),h=fillingFixtureHistory(),s=settings(),context=null)=>calculateRecord(e,{settings:s},{},{},undefined,null,context||{history:h});

test("department 4 × 40 × 8 / 800 pieces per shift = 1.6 per piece, not times work turns",()=>{
 const r=calc();assert.equal(r.fillingUnitLabor,1.6);assert.equal(r.plannedLabor,1600);assert.equal(r.actualLabor,800);
 assert.equal(r.phases[0].actualLaborPieces,500);assert.equal(r.phases[0].actualCostPersonHours,null);
});
test("cartoning pieces remain separate with no second charge for the same department",()=>{
 const e=evidence();e.works.push({...work(2,"Astucciatura"),personnel:[{start:"2026-09-07T09:00:00",end:"2026-09-07T17:00:00"}]});
 const r=calc(e);assert.equal(r.actualLabor,800);assert.equal(r.phases[1].actualLabor,0);assert.equal(r.phases[1].laborIncludedInFilling,true);
 assert.equal(r.goodQuantity,500);assert.equal(r.fillingHistory.cartoningPieces,3200);assert.equal(r.fillingHistory.completedPieces,3200);
});
test("old method and settings remain available for integrated AI to switch back",()=>{
 const e=evidence();e.works[0].personnel=[{start:"2026-09-07T09:00:00",end:"2026-09-07T11:00:00"}];
 const s=applyCostProposal(settings(),{filling:{basis:"presence_hours",roundingMinutes:30}});
 const r=calc(e,null,s);assert.equal(r.actualLabor,80);assert.equal(r.fillingHistory,null);
 assert.equal(s.laborRules.filling.roundingMinutes,30);
});
test("retroactive filling policy updates closed frozen productions but not station labor",()=>{
 const old={...defaultSettings(),laborHourly:10,mixingOperatorsCount:2};
 const e=evidence();e.works.push({...work(3,"Semilavorato",100),start:"2026-09-07T08:00:00",end:"2026-09-07T16:00:00"});
 const before=structuredClone(e);
 const r=calc(e,null,old,{history:fillingFixtureHistory(),policy:{id:"new",settings:settings()}});
 assert.equal(r.phases[0].actualLabor,800);assert.equal(r.phases[1].actualLabor,160);
 const later=calc(e,null,old,{history:{...fillingFixtureHistory(),productivity:1600},policy:{settings:settings()}});
 assert.equal(later.phases[0].actualLabor,400);assert.deepEqual(e,before);
});
test("missing history, zero productivity, missing headcount and missing prices stay unknown",()=>{
 for(const h of [null,{...fillingFixtureHistory(),productivity:0},{...fillingFixtureHistory(),error:"offline"},{...fillingFixtureHistory(),packagingOperatorsCount:0}])assert.equal(calc(evidence(),h).actualLabor,null);
 assert.equal(fillingUnitLabor(fillingFixtureHistory(),""),null);assert.equal(fillingUnitLabor(fillingFixtureHistory(),0),0);
 assert.equal(calc({...evidence(),works:[work(1,"Astucciatura")]}).actualLabor,null);
});
test("open, unstarted, missing or negative quantities, non-piece units never become actual zero",()=>{
 for(const w of [{...work(),state:"InProduzione"},{...work(),state:"DaAvviare"},{...work(),goodQuantity:null},{...work(),goodQuantity:-1},{...work(),unit:"KG"},{...work(),end:null}])
  assert.equal(calc({...evidence(),works:[w]}).actualLabor,null);
 assert.equal(calc({...evidence(),works:[work(1,"Confezionamento",0)]}).actualLabor,0);
 assert.equal(calc({...evidence(),unit:"KG",works:[{...work(),unit:"KG"}]}).plannedLabor,null);
});
test("split work and daily operations do not multiply order forecast or duplicate actual pieces",()=>{
 const e=evidence();e.works=[work(1,"Confezionamento",300),{...work(2,"Confezionamento",200),machineId:3},work(1,"Confezionamento",300)];
 e.baseline.operations.push({...e.baseline.operations[0],impiantoId:3},{...e.baseline.operations[0],start:"2026-09-08T09:00:00"});
 const r=calc(e);assert.equal(r.phases.length,2);assert.equal(r.plannedLabor,1600);assert.equal(r.actualLabor,800);
 assert.equal(r.phases.reduce((s,p)=>s+p.plannedLaborPieces,0),1000);
});
test("extra shifts use same calendar as station including idle shifts and excluding current",()=>{
 const h={...fillingFixtureHistory(),asOfLocal:"2026-09-08T18:00:00",works:[{...work(),end:"2026-09-07T12:00:00"},work(2,"Astucciatura",500)]};
 const s=settings();s.shifts.push({name:"Secondo",start:"17:00",end:"23:00",days:[1,2,3,4,5],breakMinutes:0});
 const r=withAdditionalFillingShifts(h,s);assert.equal(r.calendarShifts,3);assert.equal(r.completedPieces,500);
 assert.equal(r.productivity,500/3);assert.equal(r.cartoningPieces,500);
 assert.throws(()=>withAdditionalFillingShifts(h,{...s,shifts:[s.shifts[0],{...s.shifts[1],start:"16:00"}]}),/sovrappone/);
 const invalid=withAdditionalFillingShifts({...h,works:[{...h.works[0],unit:"KG"}]},s);assert.equal(invalid.productivity,null);
});
test("effective policy and summary respect date and never expose other customers work IDs",()=>{
 const configs=[{id:"active",effective_from:"2026-01-01",settings:settings()},{id:"future",effective_from:"2027-01-01",settings:defaultSettings()}];
 assert.equal(activeFillingPolicy(configs,"2026-09-13").id,"active");assert.equal(activeFillingPolicy(configs,"2027-01-01"),null);
 assert.equal(fillingHistorySummary({...fillingFixtureHistory(),works:[work()]}).works,undefined);
});
test("AI can propose both implemented modes with deterministic preview and without changing station",()=>{
 const base={...settings(),laborRules:{station:{basis:"historical_productivity"},filling:{basis:"presence_hours",roundingMinutes:30}}};
 const proposal={readyForApproval:true,questions:[],patch:{filling:{basis:"historical_pieces"}}};
 const r=evaluateCostProposal(base,proposal,null,fillingFixtureHistory());
 assert.equal(r.candidate.laborRules.station.basis,"historical_productivity");assert.equal(r.candidate.laborRules.filling.roundingMinutes,30);
 assert.equal(r.examples.rows[1].actual,1600);assert.equal(r.examples.rows[1].planned,1600);
 assert.equal(proposalChanges(base,r.candidate)[0].name,"Base FILLING");
 assert.equal(costExamples(r.candidate).rows[1].actual,null);
 assert.match(COST_SYSTEM_PROMPT,/DUE modalità IMPLEMENTATE/);
 assert.deepEqual(COST_PROPOSAL_SCHEMA.properties.patch.properties.filling.properties.basis.anyOf[0].enum,["presence_hours","historical_pieces"]);
 assert.throws(()=>validateSettings({...settings(),laborRules:{filling:{basis:"cartoning_autonomous"}}}),/FILLING/);
 assert.throws(()=>applyCostProposal(base,{filling:{packagingOperatorsCount:8}}),/non supportati/);
});
test("filling history client contract is sanitized and not available through public MES proxy",async()=>{
 const client=createProgremesClient({baseUrl:"https://mes.example.test",secret:"test-only",logger:{error(){}},fetchFn:async()=>new Response(JSON.stringify([{...fillingFixtureHistory(),secretValue:"omit"}]),{status:200})});
 const rows=await client.request("production-cost-filling-history");
 assert.equal(rows[0].completedPieces,3200);assert.equal(rows[0].secretValue,undefined);
 assert(!PROGREMES_ALLOWED_RESOURCES.includes("production-cost-filling-history"));
 await assert.rejects(()=>handleProductionCosts({headers:{}},{operation:"filling-history"}),/Sessione mancante/);
});
test("immutable snapshots are idempotent and unavailable MES does not fall back",async()=>{
 const data=new Map();let inserts=0;
 const admin={async rpc(){return {data:{versions:[{effectiveFrom:"1900-01-01",week:Object.fromEntries([1,2,3,4,5,6,7].map(d=>[d,d<6?[["09:00","16:00"]]:[]]))}],exceptions:[],closures:[]}};},from(name){assert.equal(name,"production_cost_station_history");let key;return {async upsert(row,options){assert.equal(options.ignoreDuplicates,true);assert.equal(row.source.economicDepartment,"Confezionamento");if(!data.has(row.fingerprint))data.set(row.fingerprint,{id:"snapshot-"+(++inserts),created_at:"now"});return {};},select(){return this;},eq(_field,value){key=value;return this;},async single(){return {data:data.get(key)};}};}};
 const a=await readFillingHistory(admin,{request:async()=>[fillingFixtureHistory()]});
 const b=await readFillingHistory(admin,{request:async()=>[{...fillingFixtureHistory(),generatedAt:"later",asOfLocal:"later"}]});
 assert.equal(a.snapshotId,b.snapshotId);assert.equal(inserts,1);
 await readFillingHistory(admin,{request:async()=>[{...fillingFixtureHistory(),works:[work()]}]});assert.equal(inserts,2);
 const missing=await readFillingHistory(admin,{request:async()=>{throw {upstreamStatus:404};}});assert.equal(missing.productivity,null);assert.match(missing.error,/Aggiornare MES/);
 const sql=await readFile(new URL("../supabase/migrations/20260913130000_production_station_history.sql",import.meta.url),"utf8");
 assert.match(sql,/enable row level security/);assert.match(sql,/grant select,insert/);assert.doesNotMatch(sql,/grant.*update/i);
});

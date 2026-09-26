import test from "node:test";
import assert from "node:assert/strict";
import { calculateRecord,defaultSettings } from "../src/features/production-costs/cost-engine.js";
import { historicalStationTurns,historicalLabor,activeStationPolicy,stationHistorySummary } from "../src/features/production-costs/station-history.js";
import { applyCostProposal,costExamples } from "../src/features/production-costs/cost-proposals.js";
import { readStationHistory } from "./production-station-history.js";
import { evaluateCostProposal,COST_SYSTEM_PROMPT } from "./ai/production-costs.js";
import { buildProgremesUrl,PROGREMES_ALLOWED_RESOURCES } from "./progremes-readonly-client.js";
const settings=()=>({...defaultSettings(),laborHourly:40,mixingOperatorsCount:99,laborRules:{station:{basis:"historical_productivity"}},machines:[]});
const history=()=>({generatedAt:"2026-09-11T15:00:00Z",asOfLocal:"2026-09-11T17:00:00",periodStart:"2026-09-07T09:00:00",periodEnd:"2026-09-11T16:00:00",completedWorks:10,calendarShifts:5,productivity:2,mixingOperatorsCount:3,error:null,works:[],calendar:{source:"MES",shifts:[{name:"MES",start:"09:00",end:"16:00",days:[1,2,3,4,5],breakMinutes:0}],closures:[],historyWarning:"Calendario ricostruito."}});
const work=()=>({id:1,machineId:1,phase:"Semilavorato",state:"Terminato",start:"2026-09-07T09:00:00",end:"2026-09-08T11:00:00",personnel:[],goodQuantity:100});
test("historical formula uses global productivity and active MES headcount, not saved stale count",()=>{
 const r=calculateRecord({works:[work()]},{settings:settings()},{},{},undefined,{history:history()});
 assert.equal(r.phases[0].actualTurns,1.5);assert.equal(r.actualLabor,3*40*8/2*1.5);
 assert.equal(r.phases[0].mixingOperatorsCount,3);
});
test("past closed productions recalculate after productivity changes without mutating evidence",()=>{
 const e={works:[work()]},before=structuredClone(e);
 const calc=h=>calculateRecord(e,{settings:settings()},{},{},undefined,{history:h});
 assert.equal(calc(history()).actualLabor,720);
 assert.equal(calc({...history(),productivity:1}).actualLabor,1440);
 assert.deepEqual(e,before);
});
test("retroactive policy affects STATION only, even with original baseline and another old tariff",()=>{
 const old={...defaultSettings(),laborHourly:10,mixingOperatorsCount:2},h=history();
 const filling={...work(),id:2,machineId:2,phase:"Confezionamento",personnel:[{start:"2026-09-07T09:00:00",end:"2026-09-07T11:00:00"}]};
 const r=calculateRecord({baseline:{capturedAt:"2026-09-01"},works:[work(),filling]},{settings:old},{},{},undefined,{history:h,policy:{id:"new",settings:settings()}});
 assert.equal(r.phases[0].actualLabor,720);assert.equal(r.phases[1].actualLabor,20);
});
test("historical policy works for records still missing original configuration",()=>{
 const r=calculateRecord({works:[work()]},null,{},{},undefined,{history:history(),policy:{settings:settings()}});
 assert.equal(r.actualLabor,720);
});
test("missing or zero historical productivity never falls back to old formula or zero",()=>{
 for(const h of [null,{...history(),productivity:0},{...history(),error:"offline"},{...history(),mixingOperatorsCount:0}]){
  assert.equal(calculateRecord({works:[work()]},{settings:settings()},{},{},undefined,{history:h}).actualLabor,null);
 }
 assert.equal(historicalLabor(.5,history(),""),null);
 assert.equal(historicalLabor(.5,history(),0),0); // Explicit free tariff remains valid.
});
test("MES shift rounding, half-shift minimum, closures and overtime are explicit",()=>{
 const h=history();
 assert.equal(historicalStationTurns("2026-09-07T09:00:00","2026-09-07T09:01:00",h).turns,.5);
 assert.equal(historicalStationTurns("2026-09-07T17:00:00","2026-09-07T18:00:00",h).turns,0);
 h.calendar.closures=[{from:"2026-09-08",to:"2026-09-08"}];
 assert.equal(historicalStationTurns("2026-09-07T09:00:00","2026-09-09T11:00:00",h).turns,1.5);
 const s=settings();s.referenceShiftHours=24;s.laborRules.station.overtimeMultiplier=5;
 const r=calculateRecord({works:[{...work(),end:"2026-09-07T17:00:00"}]},{settings:s},{},{},undefined,{history:h});
 assert.equal(r.actualLabor,480); // Fixed 8 economic hours, no overtime surcharge.
});
test("latest effective historical mode is global; future versions do not activate early",()=>{
 const configs=[{id:"old",effective_from:"2026-01-01",settings:settings()},{id:"future",effective_from:"2027-01-01",settings:defaultSettings()}];
 assert.equal(activeStationPolicy(configs,"2026-09-13").id,"old");
 assert.equal(activeStationPolicy(configs,"2027-01-01"),null);
 assert.equal(stationHistorySummary({...history(),works:[{id:999}]}).works,undefined);
});
test("AI supports historical mode without changing filling, calendars or headcount",()=>{
 const base={...settings(),laborRules:{station:{basis:"shifts"}}};
 const candidate=applyCostProposal(base,{station:{basis:"historical_productivity"}});
 assert.equal(candidate.mixingOperatorsCount,99);assert.deepEqual(candidate.shifts,base.shifts);
 const result=evaluateCostProposal(base,{readyForApproval:true,questions:[],patch:{station:{basis:"historical_productivity"}}},history());
 assert.equal(result.examples.rows[0].actual,720);
 assert.match(COST_SYSTEM_PROMPT,/ricalcola ANCHE le produzioni già concluse/);
 assert.equal(costExamples(candidate,history()).rows[1].actual,240);
});
test("MES source is internal-only and snapshots are immutable/idempotent across reads",async()=>{
 assert.match(buildProgremesUrl("production-cost-station-history",{},"https://mes.example.it").href,/production-cost-station-history/);
 assert(!PROGREMES_ALLOWED_RESOURCES.includes("production-cost-station-history"));
 const data=new Map();let inserts=0;
 const admin={async rpc(){return {data:{versions:[{effectiveFrom:"1900-01-01",week:Object.fromEntries([1,2,3,4,5,6,7].map(d=>[d,d<6?[["09:00","16:00"]]:[]]))}],exceptions:[],closures:[]}};},from(){let key;return {async upsert(row,options){assert.equal(options.ignoreDuplicates,true);if(!data.has(row.fingerprint)){data.set(row.fingerprint,{id:"snapshot-"+(++inserts),created_at:"now"});}return {};},select(){return this;},eq(_field,value){key=value;return this;},async single(){return {data:data.get(key)};}};}};
 const request=async()=>[history()];
 const a=await readStationHistory(admin,{request}),b=await readStationHistory(admin,{request:async()=>[{...history(),generatedAt:"later",asOfLocal:"later"}]});
 assert.equal(a.snapshotId,b.snapshotId);assert.equal(inserts,1);
 await readStationHistory(admin,{request:async()=>[{...history(),completedWorks:11,productivity:2.2}]});assert.equal(inserts,2);
 const fail=await readStationHistory(admin,{request:async()=>{throw {upstreamStatus:404};}});
 assert.equal(fail.productivity,null);assert.match(fail.error,/Aggiornare MES/);
});

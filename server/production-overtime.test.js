import test from "node:test";
import assert from "node:assert/strict";
import { productionTurns,explicitOvertimeHours } from "../src/features/production-costs/turns.js";
import { validateOvertime,latestCostAdjustment,currentOvertime } from "../src/features/production-costs/overtime.js";
import { withAdditionalStationShifts,historicalStationTurns } from "../src/features/production-costs/station-history.js";
import { calculateRecord,defaultSettings } from "../src/features/production-costs/cost-engine.js";
const shift={name:"Turno 1",start:"09:00",end:"16:00",days:[1,2,3,4,5],breakMinutes:0};
const settings={...defaultSettings(),laborHourly:40,shifts:[shift],mixingOperatorsCount:3};
const entry={productionId:1,start:"2026-09-07T17:00",end:"2026-09-07T19:00"};
const work={id:1,machineId:1,phase:"Semilavorato",state:"Terminato",start:"2026-09-07T09:00:00",end:"2026-09-07T19:00:00"};
const history={asOfLocal:"2026-09-08T16:00:00",works:[work],mixingOperatorsCount:3,productivity:2,error:null,calendar:{shifts:[shift],closures:[],source:"MES",historyWarning:"Orari attuali retroattivi."}};
test("automatic overtime stops at 17, configured second shift still counts",()=>{
 assert.equal(productionTurns(work.start,work.end,settings).overtimeHours,1);
 assert.equal(productionTurns(entry.start,entry.end,settings).overtimeHours,0);
 const two={...settings,shifts:[shift,{...shift,name:"Secondo turno",start:"17:00",end:"21:00"}]};
 assert.equal(productionTurns(work.start,work.end,two).turns,1.5);
 assert.equal(productionTurns(work.start,work.end,two).overtimeHours,0);
 assert.equal(explicitOvertimeHours([entry],two),0);
});
test("historical cost separates explicit overtime at mean shift cost / 8 and preserves half turns",()=>{
 const config={settings:{...settings,laborRules:{station:{basis:"historical_productivity",overtimeMultiplier:1.5}}}};
 const calc=adjustment=>calculateRecord({works:[work]},config,adjustment,{},undefined,{history});
 assert.equal(calc({}).actualLabor,480);
 const result=calc({overtime:[entry]});
 assert.equal(result.phases[0].actualTurns,1);
 assert.equal(result.phases[0].actualOvertimeHours,2);
 assert.equal(result.actualLabor,480+480/8*2*1.5);
 assert.equal(historicalStationTurns(entry.start,entry.end,history).turns,0);
 assert.equal(calculateRecord({works:[{...work,start:entry.start}]},config,{}, {},undefined,{history}).actualLabor,0);
});
test("old costing modes add only explicit after-17 hours, without double counting earlier automatic hours",()=>{
 const auto=calculateRecord({works:[work]},{settings});
 const explicit=calculateRecord({works:[work]},{settings},{overtime:[{...entry,start:"2026-09-07T16:00"}]});
 assert.equal(auto.actualLabor,3*40*9);
 assert.equal(explicit.actualLabor,3*40*11);
});
test("additional shifts extend historical denominator, including idle shifts, but exclude current shift",()=>{
 const s={...settings,shifts:[shift,{...shift,name:"Secondo turno",start:"17:00",end:"21:00"}]};
 const h=withAdditionalStationShifts({...history,asOfLocal:"2026-09-08T18:00:00"},s);
 assert.equal(h.calendarShifts,3);assert.equal(h.completedWorks,1);assert.equal(h.productivity,1/3);
 assert.equal(h.periodEnd,"2026-09-08T16:00:00");
 assert.equal(historicalStationTurns(work.start,work.end,h).turns,1.5);
 assert.equal(explicitOvertimeHours([entry],{shifts:h.calendar.shifts}),0);
 assert.throws(()=>withAdditionalStationShifts(history,{shifts:[shift,{...shift,start:"15:00",end:"19:00"}]}),/sovrappone/);
});
test("overtime validation is scoped, bounded, non-overlapping and rejects malformed timestamps",()=>{
 assert.deepEqual(validateOvertime([entry],[work],work.end),[entry]);
 for(const bad of [{...entry,productionId:2},{...entry,end:"2026-09-07T20:00"},{...entry,end:"2026-09-31T20:00"},{...entry,start:"bad"}])assert.throws(()=>validateOvertime([bad],[work],work.end));
 assert.throws(()=>validateOvertime([entry,entry],[work],work.end),/sovrapporsi/);
 assert.throws(()=>validateOvertime([entry],[{...work,phase:"Confezionamento"}],work.end));
 assert.deepEqual(currentOvertime([entry],work.start,"2026-09-07T16:00"),[]);
});
test("independent overtime and wash revisions retain history; an empty overtime revision removes prior overtime",()=>{
 const audit=[{details:{overtime:[]}},{details:{washes:[{count:2}]}},{details:{overtime:[entry]}}];
 assert.deepEqual(latestCostAdjustment(audit),{overtime:[],washes:[{count:2}]});
});

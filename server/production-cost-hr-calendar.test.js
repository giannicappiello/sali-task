import test from "node:test";
import assert from "node:assert/strict";
import { defaultSettings,scheduledHours,validateSettings } from "../src/features/production-costs/cost-engine.js";
import { productionTurns,explicitOvertimeHours } from "../src/features/production-costs/turns.js";
import { withAdditionalStationShifts,historicalStationTurns } from "../src/features/production-costs/station-history.js";
import { withAdditionalFillingShifts } from "../src/features/production-costs/filling-history.js";
import { readCostCalendar } from "./production-cost-calendar.js";
import { evaluateCostProposal } from "./ai/production-costs.js";
const week=(start,end)=>Object.fromEntries([1,2,3,4,5,6,7].map(d=>[d,d<6?[[start,end]]:[]]));
const calendar=()=>({validUntil:"2030-12-31",versions:[{effectiveFrom:"2026-09-01",week:week("08:00","16:00")},{effectiveFrom:"2026-09-08",week:week("09:00","17:00")}],exceptions:[{day:"2026-09-10",intervals:[["10:00","12:00"]]}],closures:[{from:"2026-09-09",to:"2026-09-09",reason:"Chiusura"}]});
const settings=()=>({...defaultSettings(),laborHourly:35,companyCalendar:calendar(),holidays:["2026-09-07"],shifts:[{name:"Obsoleto",start:"01:00",end:"02:00",days:[1,2,3,4,5],breakMinutes:0}]});
test("HR versions, closures and exceptions override obsolete economic settings",()=>{
 const s=settings();
 assert.equal(scheduledHours("2026-09-07T08:00:00","2026-09-10T17:00:00",s),18);
 assert.equal(productionTurns("2026-09-07T08:00:00","2026-09-10T17:00:00",s).turns,3);
 assert.equal(scheduledHours("2026-09-08T08:00:00","2026-09-08T09:00:00",s),0);
 assert.equal(explicitOvertimeHours([{start:"2026-09-08T16:00:00",end:"2026-09-08T18:00:00"}],s),1);
});
test("missing HR date or source never falls back to saved manual calendar",async()=>{
 assert.throws(()=>scheduledHours("2026-08-31T08:00:00","2026-08-31T16:00:00",settings()),/HR/);
 assert.throws(()=>scheduledHours("2026-09-07T08:00:00","2026-09-07T16:00:00",{...settings(),companyCalendar:null}),/HR/);
 await assert.rejects(()=>readCostCalendar({rpc:async()=>({error:{message:"offline"}})}),/HR/);
});
test("HR historical denominator includes idle completed slots, excludes closure and current slot in both departments",()=>{
 const source={asOfLocal:"2026-09-11T12:00:00",mixingOperatorsCount:3,packagingOperatorsCount:5,calendar:{shifts:defaultSettings().shifts},works:[{id:1,phase:"Confezionamento",state:"Terminato",start:"2026-09-07T08:00:00",end:"2026-09-08T16:00:00",goodQuantity:100,unit:"PZ"}]};
 const h=withAdditionalStationShifts(source,settings());
 assert.equal(h.calendarShifts,3);assert.equal(h.completedWorks,1);assert.equal(h.productivity,1/3);
 assert.equal(h.periodEnd,"2026-09-10T12:00:00");
 assert.equal(historicalStationTurns("2026-09-09T08:00:00","2026-09-09T17:00:00",h).turns,0);
 const f=withAdditionalFillingShifts(source,settings());assert.equal(f.calendarShifts,3);assert.equal(f.productivity,100/3);
 assert.equal(f.calendar.source,"Calendario aziendale HR");
});
test("optional empty prices can be saved but partial and invalid rows cannot",()=>{
 const s={...defaultSettings(),laborHourly:35};
 for(const prices of [[],[{articleCode:"",unit:"PZ",price:""}],[{articleCode:"  ",unit:"PZ",price:"  "}]])assert.doesNotThrow(()=>validateSettings({...s,prices}));
 for(const p of [{articleCode:"A",unit:"PZ",price:""},{articleCode:"",unit:"PZ",price:10},{customerCode:"C",unit:"PZ"},{articleCode:"A",unit:"PZ",price:-1}])assert.throws(()=>validateSettings({...s,prices:[p]}),/Prezzo stimato/);
 assert.doesNotThrow(()=>validateSettings({...s,prices:[{articleCode:"A",unit:"PZ",price:0}]}));
});
test("AI cost proposals route calendar changes to HR",()=>{
 const r=evaluateCostProposal(settings(),{readyForApproval:true,questions:[],patch:{holidays:["2026-09-07"]}});
 assert.equal(r.candidate,null);assert.match(r.validationError,/Rendicontazioni HR/);
});

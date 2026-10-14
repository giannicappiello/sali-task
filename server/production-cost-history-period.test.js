import test from "node:test";
import assert from "node:assert/strict";
import { withAdditionalStationShifts } from "../src/features/production-costs/station-history.js";
import { withAdditionalFillingShifts } from "../src/features/production-costs/filling-history.js";
import { readStationHistory } from "./production-station-history.js";
import { readFillingHistory } from "./production-filling-history.js";
import { PRODUCTION_COST_HISTORY_FROM } from "./production-cost-history-period.js";
import { validateHistoryPeriod } from "../src/features/production-costs/history-period.js";

const settings={historyFrom:PRODUCTION_COST_HISTORY_FROM};
const work=(id,start,end,extra={})=>({id,start,end,state:"Terminato",phase:"Confezionamento",unit:"PZ",goodQuantity:100,...extra});
const source=()=>({asOfLocal:"2026-10-05T12:00:00",generatedAt:"now",completedWorks:100,calendarShifts:100,completedPieces:10000,cartoningPieces:10000,
 mixingOperatorsCount:3,packagingOperatorsCount:4,
 calendar:{source:"MES",shifts:[{start:"08:00",end:"16:00",days:[1,2,3,4,5],breakMinutes:0}],closures:[]},
 works:[work(1,"2026-09-29T08:00:00","2026-09-30T16:00:00"),work(2,"2026-09-30T08:00:00","2026-10-01T10:00:00"),work(3,"2026-10-02T08:00:00","2026-10-02T16:00:00"),work(4,"2026-10-05T08:00:00","2026-10-05T10:00:00"),work(5,"2026-10-01T08:00:00","2026-10-01T12:00:00",{state:"Annullato"})]});
test("both department averages start on October 1 by completion date and exclude the current shift",()=>{
 const s=source(),copy=structuredClone(s);
 const h=withAdditionalStationShifts(s,settings),f=withAdditionalFillingShifts(s,settings);
 for(const r of [h,f]){assert.equal(r.periodStart,"2026-10-01T00:00:00");assert.equal(r.periodEnd,"2026-10-02T16:00:00");assert.equal(r.calendarShifts,2);assert.equal(r.completedWorks,2);}
 assert.equal(h.productivity,1);assert.equal(f.completedPieces,200);assert.equal(f.productivity,100);
 assert.deepEqual(s,copy);
});
test("fixed start includes idle shifts before the first October closure and keeps prior invalid data outside the sample",()=>{
 const s=source();s.works=[work(1,"2026-09-29T08:00:00",null),work(2,"2026-10-02T08:00:00","2026-10-02T16:00:00")];
 const h=withAdditionalStationShifts(s,settings);assert.equal(h.calendarShifts,2);assert.equal(h.completedWorks,1);assert.equal(h.productivity,.5);
});
test("company closures apply equally to both averages, including isolated cartoning quantities",()=>{
 const s=source();s.calendar.closures=[{from:"2026-10-01",to:"2026-10-01"}];
 s.works.push(work(6,"2026-09-29T08:00:00","2026-09-30T16:00:00",{phase:"Astucciatura",goodQuantity:5000}));
 s.works.push(work(7,"2026-09-30T08:00:00","2026-10-02T16:00:00",{phase:"Astucciatura",goodQuantity:300}));
 const f=withAdditionalFillingShifts(s,settings);assert.equal(f.calendarShifts,1);assert.equal(f.completedPieces,200);assert.equal(f.cartoningPieces,300);
});
test("recalculation for an old configuration retains the bounded source period",()=>{
 const h=withAdditionalStationShifts(source(),settings);
 assert.equal(withAdditionalStationShifts(h,{companyCalendar:{versions:[{effectiveFrom:"1900-01-01",week:Object.fromEntries([1,2,3,4,5,6,7].map(d=>[d,d<6?[["08:00","16:00"]]:[]]))}],exceptions:[],closures:[]}}).completedWorks,2);
});
test("no completions or a future sample start remain unavailable rather than borrowing September output",()=>{
 const s=source();s.works=s.works.slice(0,1);
 const h=withAdditionalStationShifts(s,settings);assert.equal(h.completedWorks,0);assert.equal(h.productivity,null);assert.equal(h.calendarShifts,2);
 const future=withAdditionalStationShifts({...s,asOfLocal:"2026-09-30T17:00:00"},settings);assert.equal(future.calendarShifts,0);assert.equal(future.productivity,null);
});
test("live readers use the October start by default and archive newly calculated department evidence",async()=>{
 const stored=[];
 const admin={from(){return {async upsert(row){stored.push(row.source);return {};},select(){return this;},eq(){return this;},async single(){return {data:{id:"new-period",created_at:"now"}};}};}};
 const calendar={versions:[{effectiveFrom:"1900-01-01",week:Object.fromEntries([1,2,3,4,5,6,7].map(d=>[d,d<6?[["08:00","16:00"]]:[]]))}],exceptions:[],closures:[]};
 const a=await readStationHistory(admin,{companyCalendar:calendar,request:async()=>[source()]});
 const b=await readFillingHistory(admin,{companyCalendar:calendar,request:async()=>[source()]});
 assert.equal(a.historyFrom,"2026-10-01");assert.equal(b.historyFrom,"2026-10-01");assert.equal(stored.length,2);
 assert.equal(a.completedWorks,2);assert.equal(b.completedPieces,200);
});
test("inclusive end date limits both output and shifts, and an empty end restores the live period",()=>{
 const s={...source(),asOfLocal:"2026-10-06T17:00:00"};
 s.works.push(work(6,"2026-10-06T08:00:00","2026-10-06T16:00:00"));
 const bounded={historyFrom:"2026-10-01",historyTo:"2026-10-01"};
 const h=withAdditionalStationShifts(s,bounded),f=withAdditionalFillingShifts(s,bounded);
 assert.equal(h.completedWorks,1);assert.equal(h.calendarShifts,1);assert.equal(f.completedPieces,100);
 assert.equal(h.periodEnd,"2026-10-01T16:00:00");assert.equal(h.historyTo,"2026-10-01");
 const reset=withAdditionalStationShifts(h,{historyFrom:"2026-10-01",historyTo:""});assert.equal(reset.completedWorks,4);assert.equal(reset.calendarShifts,4);
 const future=withAdditionalStationShifts(s,{historyFrom:"2026-10-01",historyTo:"2026-12-31"});assert.equal(future.calendarShifts,4);
});
test("date configuration rejects inverted ranges and impossible dates but permits a live end",()=>{
 for(const p of [{historyFrom:"2026-02-30"},{historyFrom:"bad"},{historyTo:"2026-10-00"},{historyFrom:"2026-10-10",historyTo:"2026-10-01"},{historyFrom:""}])assert.throws(()=>validateHistoryPeriod(p));
 assert.doesNotThrow(()=>validateHistoryPeriod({}));
 assert.doesNotThrow(()=>validateHistoryPeriod({historyFrom:"2026-10-01",historyTo:""}));
 assert.doesNotThrow(()=>validateHistoryPeriod({historyFrom:"2026-10-01",historyTo:"2026-10-01"}));
});

import { productionTurns, shiftWindows } from "./turns.js";

// The denominator comes from the complete MES department, never UI filters.
export function historyCalendar(history) {
 if(history?.calendar?.companyCalendar)return {companyCalendar:history.calendar.companyCalendar,shifts:history.calendar.shifts,laborRules:{station:{rounding:.5}}};
 if(!history?.calendar?.shifts?.length)return null;
 const holidays=[];
 for(const c of history.calendar.closures||[]){
  const start=new Date(String(c.from).slice(0,10)+"T00:00:00Z"),end=new Date(String(c.to).slice(0,10)+"T00:00:00Z");
  if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<start||end-start>36600*86400000)return null;
  for(let day=start;day<=end;day=new Date(+day+86400000))holidays.push(day.toISOString().slice(0,10));
 }
 return {shifts:history.calendar.shifts,holidays,laborRules:{station:{rounding:.5}}};
}
export function historicalStationTurns(start,end,history,downtimeHours=0) {
 const calendar=historyCalendar(history);
 const counts=calendar?productionTurns(start,end,calendar,downtimeHours):null;
 // No minimum charge when the whole interval is outside the calendar.
 return counts?{...counts,overtimeHours:0,turns:counts.scheduledHours>0?Math.max(.5,Math.ceil(counts.turns*2-1e-9)/2):0}:null;
}

// A configured second/additional shift extends the economic calendar only;
// MES planning and the first MES shift are left untouched.
export function withAdditionalStationShifts(source,settings) {
 const extra=settings?.shifts?.slice(1)||[];
 if(!extra.length&&!settings?.companyCalendar)return source;
 const calendar=settings?.companyCalendar?{shifts:[],holidays:[]}:historyCalendar(source);
 if(!calendar)return {...source,error:"Calendario MES non disponibile.",productivity:null};
 const shifts=[...calendar.shifts,...extra];
 const merged={...calendar,shifts,...(settings?.companyCalendar?{companyCalendar:settings.companyCalendar}:{})};
 const weekly=settings?.companyCalendar?[]:shiftWindows("2026-09-07T00:00:00","2026-09-15T00:00:00",{...merged,holidays:[]});
 if(weekly.some((w,i)=>i&&w.a<weekly[i-1].b))throw Object.assign(new Error("Il secondo turno si sovrappone al turno MES: verificare gli orari."),{code:"INVALID_COST_CALENDAR"});
 const active=[...new Map((source.works||[]).filter(w=>!["Annullato","DaAvviare"].includes(w.state)&&w.start<=source.asOfLocal).map(w=>[w.id,w])).values()];
 const first=active.map(w=>w.start).sort()[0];
 if(!first)return {...source,error:"Nessuna attività STATION avviata disponibile.",productivity:null};
 const wall=v=>new Date(String(v).replace(/(Z|[+-]\d\d:\d\d)$/,"")+"Z");
 const completed=shiftWindows(first,source.asOfLocal,merged).filter(w=>w.b<=wall(source.asOfLocal));
 const end=completed.at(-1)?.b.toISOString().slice(0,19)||null;
 const closed=active.filter(w=>w.state==="Terminato"&&w.end&&w.end>=w.start&&end&&wall(w.end)<=wall(end)).length;
 const invalid=active.some(w=>w.state==="Terminato"&&(!w.end||w.end<w.start));
 const error=invalid?"Lavorazioni concluse con date incoerenti.":!completed.length?"Nessun turno completato.":!closed?"Media storica pari a zero.":source.mixingOperatorsCount<=0?"Organico Miscelazione non disponibile.":null;
 return {...source,periodStart:first,periodEnd:end,completedWorks:closed,calendarShifts:completed.length,productivity:error?null:closed/completed.length,error,
  calendar:settings?.companyCalendar?{shifts,companyCalendar:settings.companyCalendar,source:"Calendario aziendale HR",historyWarning:"Orari HR secondo la decorrenza, con eccezioni e chiusure delle rispettive date. Ogni fascia di apertura HR vale un turno; le pause fra fasce sono escluse."}:{...source.calendar,shifts,source:source.calendar.source+" + turni aggiuntivi economici Workspace",historyWarning:source.calendar.historyWarning+" I turni aggiuntivi configurati vengono applicati anche allo storico; non modificano APS."}};
}
export function historicalLabor(turns,history,hourly) {
 if(turns===null||!history||history.error||!(history.productivity>0)||!(history.mixingOperatorsCount>0)||hourly===null||hourly===undefined||hourly===""||!Number.isFinite(Number(hourly)))return null;
 return history.mixingOperatorsCount*8*Number(hourly)/history.productivity*turns;
}
export function activeStationPolicy(configs,today) {
 const latest=[...configs].filter(c=>String(c.effective_from).slice(0,10)<=today)
  .sort((a,b)=>String(b.effective_from).localeCompare(String(a.effective_from))||String(b.created_at).localeCompare(String(a.created_at)))[0];
 return latest?.settings?.laborRules?.station?.basis==="historical_productivity"?latest:null;
}
export function stationHistorySummary(history) {
 if(!history)return null;
 // Never expose another customer's work IDs/timestamps to the report caller.
 const summary={...history};delete summary.works;
 return summary;
}

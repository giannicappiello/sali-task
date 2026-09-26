import { costDayShifts } from "./hr-cost-calendar.js";
const wall = value => new Date(String(value).replace(/(Z|[+-]\d\d:\d\d)$/,"")+"Z");
const minutes = value => {const [h,m]=value.split(":").map(Number);return h*60+m;};
const dayKey = date => date.toISOString().slice(0,10);

// Calendar intervals retain plant wall-clock time (no server timezone conversion).
export function shiftWindows(start,end,settings) {
 const from=wall(start),to=wall(end),windows=[],day=new Date(from);
 if(!Number.isFinite(+from)||!Number.isFinite(+to)||to<from||to-from>36600*86400000)throw new Error("Intervallo calendario non valido.");
 day.setUTCHours(0,0,0,0);if(!settings.companyCalendar)day.setUTCDate(day.getUTCDate()-1);
 for(;day<=to;day.setUTCDate(day.getUTCDate()+1)){
  for(const shift of costDayShifts(settings,dayKey(day))){
   const a=new Date(+day+minutes(shift.start)*60000);
   let b=new Date(+day+minutes(shift.end)*60000);if(b<=a)b=new Date(+b+86400000);
   if(b>from&&a<to)windows.push({a,b});
  }
 }
 return windows.sort((a,b)=>a.a-b.a);
}

// Explicit overtime is never inferred from a late completion. Scheduled time
// is subtracted so a second shift cannot also be paid as overtime.
export function explicitOvertimeHours(intervals,settings) {
 let total=0;
 for(const interval of intervals||[]){
  const a=wall(interval.start),b=wall(interval.end);
  if(!Number.isFinite(+a)||!Number.isFinite(+b)||b<=a)throw new Error("Intervallo straordinario non valido.");
  const covered=shiftWindows(interval.start,interval.end,settings).reduce((n,w)=>n+Math.max(0,Math.min(+b,+w.b)-Math.max(+a,+w.a)),0);
  total+=Math.max(0,b-a-covered)/3600000;
 }
 return total;
}

// Round each occupied scheduled shift to the next half shift. Time between
// days is not overtime. Only work extending the first/last day's schedule is.
export function productionTurns(start,end,settings,downtimeHours=0) {
 if(!start||!end||(!settings?.shifts?.length&&!settings?.companyCalendar))return null;
 const from=wall(start),to=wall(end);
 if(!Number.isFinite(+from)||!Number.isFinite(+to)||to<from)return null;
 if(+to===+from)return {turns:0,overtimeHours:0,scheduledHours:0};
 const windows=[],day=new Date(from);day.setUTCHours(0,0,0,0);if(!settings.companyCalendar)day.setUTCDate(day.getUTCDate()-1);
 for(let count=0;day<=to&&count<36600;count++,day.setUTCDate(day.getUTCDate()+1)){
  for(const shift of costDayShifts(settings,dayKey(day))){
   const a=new Date(+day+minutes(shift.start)*60000);
   let b=new Date(+day+minutes(shift.end)*60000);if(b<=a)b=new Date(+b+86400000);
   if(b<from||a>to)continue;
   const gross=(b-a)/3600000,overlap=Math.max(0,Math.min(+to,+b)-Math.max(+from,+a))/3600000;
   windows.push({a,b,gross,overlap,paid:overlap*Math.max(0,1-Number(shift.breakMinutes||0)/(gross*60))});
  }
 }
 windows.sort((a,b)=>a.a-b.a);
 const scheduledHours=windows.reduce((sum,w)=>sum+w.paid,0);
 const factor=scheduledHours>0?Math.max(0,scheduledHours-Math.max(0,downtimeHours))/scheduledHours:0;
 const step=settings.laborRules?.station?.rounding??.5;
 const turns=windows.reduce((sum,w)=>{const fraction=Math.max(0,w.overlap/w.gross*factor);return sum+(step?Math.ceil(fraction/step-1e-9)*step:fraction);},0);
 let overtimeHours=0;
 const first=windows[0],last=windows.at(-1);
 const startCutoff=new Date(from);startCutoff.setUTCHours(17,0,0,0);
 if(first&&dayKey(from)===dayKey(first.a)&&from<first.a)overtimeHours+=Math.max(0,Math.min(+first.a,+startCutoff)-from)/3600000;
 // After 17:00 only an explicit overtime entry or a scheduled shift is paid.
 const cutoff=new Date(to);cutoff.setUTCHours(17,0,0,0);
 if(last&&dayKey(to)===dayKey(last.b)&&to>last.b)overtimeHours+=Math.max(0,Math.min(+to,+cutoff)-last.b)/3600000;
 if(!windows.length&&dayKey(from)===dayKey(to))overtimeHours=Math.max(0,Math.min(+to,+cutoff)-from)/3600000;
 overtimeHours=Math.max(0,overtimeHours-Math.max(0,downtimeHours-scheduledHours));
 return {turns,overtimeHours,scheduledHours:scheduledHours*factor};
}

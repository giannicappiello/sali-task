import { historyCalendar } from "./station-history.js";
const wall=v=>new Date(String(v).slice(0,10)+"T00:00:00Z");
const clock=v=>{const [h,m]=v.split(":").map(Number);return h*60+m;};
const stamp=d=>d.toISOString().slice(0,19);

// Construct accounting intervals from an independent duration, not Gantt end dates.
export function forecastOperations(evidence) {
 const timing=evidence.baseline?.plannedTiming||evidence.plannedTiming;
 if(!timing){
  return {operations:evidence.baseline?.operations||[],estimated:false,
   source:evidence.baseline?.operations?.length?"Tempi del piano originale congelato. Importare MES aggiornato per usare i parametri formula indipendenti.":"Durate preventive formula non ancora importate: aggiornare MES e importare lo storico. Il planning consuntivato non viene utilizzato."};
 }
 const calendar=historyCalendar({calendar:timing.calendar}),origin=wall(evidence.baseline?.capturedAt||evidence.date);
 if(!calendar||!Number.isFinite(+origin))return {operations:[],estimated:true,source:"Calendario o data ordine mancanti: durata preventiva non collocabile."};
 const windows=[];
 const shortest=Math.min(...calendar.shifts.map(s=>(clock(s.end)-clock(s.start)+1440)%1440).filter(m=>m>0));
 const total=(timing.operations||[]).reduce((sum,r)=>sum+Math.max(0,Number(r.durationMinutes)||0)*Math.max(1,Number(r.lotCount)||1),0);
 const horizon=Math.min(3660,14+Math.ceil(total/shortest)*7+calendar.holidays.length);
 for(let n=0;n<horizon;n++){
  const day=new Date(+origin+n*86400000),key=stamp(day).slice(0,10);
  if(calendar.holidays.includes(key))continue;
  for(const shift of calendar.shifts)if(shift.days.includes(day.getUTCDay())){
   const a=+day+clock(shift.start)*60000;let b=+day+clock(shift.end)*60000;if(b<=a)b+=86400000;
   windows.push({a,b});
  }
 }
 windows.sort((a,b)=>a.a-b.a);
 const operations=[];
 for(const row of timing.operations||[]){
  const minutes=Number(row.durationMinutes),lots=Number(row.lotCount);
  if(row.durationMinutes==null||!Number.isFinite(minutes)||minutes<0||!Number.isInteger(lots)||lots<1||lots>10000)continue;
  let cursor=+origin;const rowOperations=[];
  for(let lot=0;lot<lots;lot++){
   let remaining=minutes*60000,start=null,end=null;
   for(const window of windows){
    if(window.b<=cursor)continue;
    // Production lots occupy fresh shifts just as the APS planner does.
    if(row.type==="Production"&&window.a<cursor)continue;
    const a=Math.max(cursor,window.a);
    if(start===null)start=a;
    const used=Math.min(remaining,window.b-a);remaining-=used;end=a+used;
    if(remaining<=0)break;
   }
   if(remaining>0||start===null)break;
   rowOperations.push({...row,start:stamp(new Date(start)),end:stamp(new Date(end)),quantity:row.quantity==null?null:row.quantity/lots,estimatedFromParameters:true});
   cursor=end;
  }
  if(rowOperations.length===lots)operations.push(...rowOperations);
 }
 return {operations,estimated:true,source:timing.source+" Intervalli ricostruiti dalla data ordine/copia preventiva, senza tempi effettivi; ripartizione uniforme fra lavorazioni della stessa fase e macchina."};
}

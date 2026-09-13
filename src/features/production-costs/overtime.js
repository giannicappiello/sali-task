const wall = value => new Date(String(value).replace(/(Z|[+-]\d\d:\d\d)$/,"")+"Z");
export function validateOvertime(entries,works,now) {
 if(!Array.isArray(entries)||entries.length>200)throw new Error("Elenco straordinari non valido.");
 const sorted=[];
 for(const e of entries){
  const w=works.find(w=>w.id===e.productionId&&w.phase==="Semilavorato");
  const stamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
  if(!w||!Number.isInteger(e.productionId)||!stamp.test(e.start)||!stamp.test(e.end))throw new Error("Lavorazione o orari straordinario non validi.");
  const a=wall(e.start),b=wall(e.end),limit=wall(w.pausedAt||w.end||now),begin=wall(w.start);
  if(!Number.isFinite(+a)||!Number.isFinite(+b)||!Number.isFinite(+limit)||!Number.isFinite(+begin)||a.toISOString().slice(0,e.start.length)!==e.start||b.toISOString().slice(0,e.end.length)!==e.end||a>=b||b-a>24*3600000||a<begin||b>limit||w.state==="DaAvviare"||w.state==="Annullato")throw new Error("Lo straordinario deve essere compreso nella lavorazione, per intervalli non superiori a 24 ore.");
  sorted.push({...e,a,b});
 }
 sorted.sort((a,b)=>a.productionId-b.productionId||a.a-b.a);
 if(sorted.some((e,i)=>i&&e.productionId===sorted[i-1].productionId&&e.a<sorted[i-1].b))throw new Error("Gli intervalli straordinari non possono sovrapporsi.");
 return entries.map(({productionId,start,end})=>({productionId,start,end}));
}
export function currentOvertime(entries,start,end) {
 const from=wall(start),to=wall(end);
 if(!Number.isFinite(+from)||!Number.isFinite(+to))return [];
 return entries.flatMap(e=>{
  const a=Math.max(+from,+wall(e.start)),b=Math.min(+to,+wall(e.end));
  return b>a?[{...e,start:new Date(a).toISOString().slice(0,19),end:new Date(b).toISOString().slice(0,19)}]:[];
 });
}
// Old modes already account for unscheduled time before 17:00.
export function after17Intervals(entries) {
 return entries.flatMap(e=>{
  const a=wall(e.start),b=wall(e.end),day=new Date(a),out=[];day.setUTCHours(0,0,0,0);
  for(;day<b;day.setUTCDate(day.getUTCDate()+1)){
   const start=Math.max(+a,+day+17*3600000),end=Math.min(+b,+day+86400000);
   if(end>start)out.push({start:new Date(start).toISOString().slice(0,19),end:new Date(end).toISOString().slice(0,19)});
  }
  return out;
 });
}
export function latestCostAdjustment(audit) {
 return {washes:audit.find(a=>a.details?.washes)?.details.washes||[],overtime:audit.find(a=>a.details?.overtime)?.details.overtime||[]};
}

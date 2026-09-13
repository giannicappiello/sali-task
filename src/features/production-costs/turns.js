const wall = value => new Date(String(value).replace(/(Z|[+-]\d\d:\d\d)$/,"")+"Z");
const minutes = value => {const [h,m]=value.split(":").map(Number);return h*60+m;};
const dayKey = date => date.toISOString().slice(0,10);

// Round each occupied scheduled shift to the next half shift. Time between
// days is not overtime. Only work extending the first/last day's schedule is.
export function productionTurns(start,end,settings,downtimeHours=0) {
 if(!start||!end||!settings?.shifts?.length)return null;
 const from=wall(start),to=wall(end);
 if(!Number.isFinite(+from)||!Number.isFinite(+to)||to<from)return null;
 if(+to===+from)return {turns:0,overtimeHours:0,scheduledHours:0};
 const windows=[],day=new Date(from);day.setUTCHours(0,0,0,0);day.setUTCDate(day.getUTCDate()-1);
 for(let count=0;day<=to&&count<36600;count++,day.setUTCDate(day.getUTCDate()+1)){
  if((settings.holidays||[]).includes(dayKey(day)))continue;
  for(const shift of settings.shifts)if(shift.days.includes(day.getUTCDay())){
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
 if(first&&dayKey(from)===dayKey(first.a)&&from<first.a)overtimeHours+=(first.a-from)/3600000;
 if(last&&dayKey(to)===dayKey(last.b)&&to>last.b)overtimeHours+=(to-last.b)/3600000;
 if(!windows.length&&dayKey(from)===dayKey(to))overtimeHours=(to-from)/3600000;
 overtimeHours=Math.max(0,overtimeHours-Math.max(0,downtimeHours-scheduledHours));
 return {turns,overtimeHours,scheduledHours:scheduledHours*factor};
}

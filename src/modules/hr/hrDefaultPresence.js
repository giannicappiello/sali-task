
import {romeDay,monthDays} from './hrTime.js';
import {agreementForDay} from './hrAgreements.js';
import {companyCalendarDay} from './companyCalendarDay.js';
import {isApprovedAbsence} from './hrCalendarPresence.js';

export function defaultPresenceEnabled(data,day){return data.attendance_policy?.mode==='default_present'&&day>=data.attendance_policy.effective_from;}
const union=intervals=>{
 const result=[];for(const [from,to] of intervals.filter(([a,b])=>Number.isFinite(a)&&b>a).sort((a,b)=>a[0]-b[0])){
  const last=result.at(-1);if(last&&from<=last[1])last[1]=Math.max(last[1],to);else result.push([from,to]);
 }return result;
};
const minutes=intervals=>intervals.reduce((sum,[a,b])=>sum+(b-a)/60000,0);
// Shift rows are supplied by workspace_hr_plan from each employee's effective agreement.
// No company opening hours are substituted for a missing employee agreement.
export function defaultPresenceDay(data,userId,day){
 const employee=data.employees.find(e=>e.user_id===userId);
 if(!defaultPresenceEnabled(data,day)||!employee?.active)return null;
 const closed=data.closures?.some(c=>c.date_from<=day&&c.date_to>=day)||companyCalendarDay(data.companyCalendar,day)?.intervals.length===0;
 const contract=agreementForDay(data.presence_schedules||data.contracts,userId,day);
 const weekdays=contract?.weekdays||[];
 const restDay=weekdays.length>0&&!weekdays.includes(new Date(day+'T12:00:00Z').getUTCDay()||7);
 const shifts=(data.calendarShifts||data.shifts||[]).filter(s=>s.user_id===userId&&s.work_date===day);
 const absence=(data.calendarRequests||data.requests||[]).filter(r=>r.user_id===userId&&isApprovedAbsence(r));
 const planned=union(shifts.map(s=>[Date.parse(s.starts_at),Date.parse(s.ends_at)]));
 const gross=minutes(planned);
 const pause=shifts.reduce((sum,s)=>sum+Number(s.break_minutes||0),0);
 const expected=closed?0:Math.max(0,gross-pause);
 const covered=union(absence.flatMap(r=>planned.map(([a,b])=>[Math.max(a,Date.parse(r.starts_at)),Math.min(b,Date.parse(r.ends_at))])));
 const absenceMinutes=Math.min(expected,minutes(covered));
 return {expected_minutes:expected,presence_minutes:Math.max(0,expected-absenceMinutes),absence_minutes:absenceMinutes,scheduled:shifts.length>0||restDay||closed,closed,restDay,shifts,planned};
}
export function defaultPresenceRows(data,days){
 return days.flatMap(day=>data.employees.flatMap(employee=>{
  const row=defaultPresenceDay(data,employee.user_id,day);
  if(!row||!row.scheduled||!row.presence_minutes)return [];
  return [{id:'default:'+day+':'+employee.user_id,user_id:employee.user_id,work_date:day,default_present:true,
   checkin_at:new Date(row.planned[0][0]).toISOString(),checkout_at:new Date(row.planned.at(-1)[1]).toISOString(),
   site_id:row.shifts[0].site_id,...row}];
 }));
}
export function applyDefaultPresence(data,month){
 if(data.attendance_policy?.mode!=='default_present')return data;
 const history=(data.attendance||[]).filter(a=>romeDay(a.checkin_at)<data.attendance_policy.effective_from);
 return {...data,attendance:[...history,...defaultPresenceRows(data,monthDays(month))]};
}
export function absenceLabelForDay(data,userId,day,now=new Date()){
 if(!defaultPresenceEnabled(data,day))return null;
 const stamp=Date.parse(now), full=data.requests.filter(r=>r.user_id===userId&&isApprovedAbsence(r)&&Date.parse(r.starts_at)<=stamp&&Date.parse(r.ends_at)>stamp);
 const names={leave:'Ferie',permission:'Permesso',illness:'Malattia',pregnancy:'Maternità'};
 if(full.length)return [...new Set(full.map(r=>names[r.kind]))].join(' / ');
 const row=defaultPresenceDay(data,userId,day);
 if(row?.closed||row?.restDay)return 'Giorno non lavorativo';
 if(!row?.scheduled)return 'Orario da configurare';
 if(row.expected_minutes===0)return 'Giorno non lavorativo';
 return 'Presente secondo orario';
}
export function dailyPresenceReport(data,userId,day){
 const row=defaultPresenceDay(data,userId,day);
 return row?{worked:row.presence_minutes,expected:row.expected_minutes-row.absence_minutes,absence:row.absence_minutes}:null;
}

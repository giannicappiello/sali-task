import { companyCalendarDay } from "../../modules/hr/companyCalendarDay.js";

// HR owns dated opening intervals; never replace missing HR evidence with MES
// or the obsolete manually configured economic calendar.
export function costDayShifts(settings, day) {
 if (!Object.hasOwn(settings,"companyCalendar")) {
  if ((settings.holidays||[]).includes(day)) return [];
  const weekday=new Date(day+"T12:00:00Z").getUTCDay();
  return (settings.shifts||[]).filter(s=>s.days.includes(weekday));
 }
 const calendar=settings.companyCalendar;
 const error=()=>Object.assign(new Error("Calendario aziendale HR non disponibile per "+day+"."),{code:"INVALID_COST_CALENDAR"});
 if (!calendar || (calendar.validUntil && day>calendar.validUntil)) throw error();
 const plan=companyCalendarDay(calendar,day);
 if (!plan || !Array.isArray(plan.intervals)) throw error();
 return plan.intervals.map(([start,end])=>({start,end,breakMinutes:0}));
}

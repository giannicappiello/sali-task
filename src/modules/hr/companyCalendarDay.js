// Company opening hours are independent of an employee's agreed working hours.
export function companyCalendarDay(calendar, day) {
  if (!calendar) return null;
  const exception = calendar.exceptions.find(item => item.day === day);
  if (exception) return { intervals: exception.intervals, reason: exception.reason };
  const closures = calendar.closures.filter(item => item.from <= day && item.to >= day);
  if (closures.length) return { intervals: [], reason: [...new Set(closures.map(item => item.reason))].join(' · ') };
  const version = calendar.versions.filter(item => item.effectiveFrom <= day).sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1);
  if (!version) return null;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
  return { intervals: version.week[String(weekday)], reason: '' };
}

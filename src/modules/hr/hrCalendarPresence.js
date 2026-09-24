export const ABSENCE_KINDS = ['leave', 'permission', 'illness', 'pregnancy'];

export function isApprovedAbsence(row) {
  return ABSENCE_KINDS.includes(row?.kind) && row.status === 'approved';
}

const civilDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(value));
export function absenceCoversDay(absence, day) {
  return isApprovedAbsence(absence)
    && absence.user_id
    && absence.starts_at
    && absence.ends_at
    && civilDay(absence.starts_at) <= day
    && civilDay(new Date(Date.parse(absence.ends_at) - 1)) >= day;
}

function isClosedDay(day, closures = [], companyCalendarDay) {
  if (closures.some(closure => closure.date_from <= day && closure.date_to >= day)) return true;
  return Boolean(companyCalendarDay && companyCalendarDay.intervals.length === 0);
}

/** Read-only derived classifications; never persisted or merged into history. */
export function unjustifiedAbsences({ day, shifts = [], attendance = [], absences = [], closures = [], companyCalendarDay = null, asOf = day }) {
  if (day > asOf || isClosedDay(day, closures, companyCalendarDay)) return [];
  const presentUsers = new Set(attendance.filter(row => row.checkin_at?.slice(0, 10) === day).map(row => row.user_id));
  const coveredUsers = new Set(absences.filter(row => absenceCoversDay(row, day)).map(row => row.user_id));
  const scheduledUsers = new Set(shifts.filter(row => row.work_date === day).map(row => row.user_id));
  return [...scheduledUsers]
    .filter(userId => !presentUsers.has(userId) && !coveredUsers.has(userId))
    .map(user_id => ({ id: `unjustified:${day}:${user_id}`, user_id, kind: 'unjustified', status: 'derived', work_date: day }));
}

export function plannedPresentCount(shifts, approvedAbsences) {
  const present = new Set();
  for (const shift of shifts) {
    let available = [[Date.parse(shift.starts_at), Date.parse(shift.ends_at)]];
    for (const absence of approvedAbsences.filter(item => item.user_id === shift.user_id)) {
      const from = Date.parse(absence.starts_at);
      const to = Date.parse(absence.ends_at);
      available = available.flatMap(([start, end]) => {
        if (to <= start || from >= end) return [[start, end]];
        return [[start, Math.min(from, end)], [Math.max(to, start), end]].filter(([a, b]) => b > a);
      });
    }
    if (available.some(([start, end]) => end > start)) present.add(shift.user_id);
  }
  return present.size;
}

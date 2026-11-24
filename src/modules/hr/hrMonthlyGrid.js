import { attendanceExportRows, attendanceDaySummary } from './hrAttendanceExport.js';
import { monthDays, romeDay, romeInstant, timeInput } from './hrTime.js';

export const CALENDAR_EVENT_LABELS = { overtime: 'Straordinario', permission: 'Permesso', leave: 'Ferie', illness: 'Malattia', pregnancy: 'Maternità' };
export const requestVersion = row => Object.fromEntries(['kind', 'starts_at', 'ends_at', 'note', 'status'].map(key => [key, row[key] ?? null]));
const hoursLabel = hours => hours.toLocaleString('it-IT', { maximumFractionDigits: 2 });
function dailyRequestHours(requests, day, kind, status) {
  const start = Date.parse(romeInstant(`${day}T00:00`));
  const next = new Date(`${day}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const end = Date.parse(romeInstant(`${next.toISOString().slice(0, 10)}T00:00`));
  const intervals = requests.filter(row => row.kind === kind && row.status === status)
    .map(row => [Math.max(start, Date.parse(row.starts_at)), Math.min(end, Date.parse(row.ends_at))])
    .filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0]);
  let until = start, duration = 0;
  for (const [from, to] of intervals) { duration += Math.max(0, to - Math.max(from, until)); until = Math.max(until, to); }
  return duration / 3600000;
}
export function eventsForDay(requests, userId, day) {
  const start = Date.parse(romeInstant(`${day}T00:00`));
  const next = new Date(`${day}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const end = Date.parse(romeInstant(`${next.toISOString().slice(0, 10)}T00:00`));
  return requests.filter(row => row.user_id === userId && CALENDAR_EVENT_LABELS[row.kind] && ['approved', 'pending'].includes(row.status) && Date.parse(row.starts_at) < end && Date.parse(row.ends_at) > start);
}
export function monthlyAttendance(data, month, now = new Date()) {
  const today = romeDay(now), days = monthDays(month), grouped = new Map();
  for (const detail of attendanceExportRows(data, month, now)) {
    if (!grouped.has(detail.employeeId)) grouped.set(detail.employeeId, []);
    const summary = attendanceDaySummary(detail), future = detail.Data > today;
    const missingSchedule = detail.Note.includes('Orario dipendente non configurato');
    const unknown = summary.unknown && !future && !missingSchedule;
    const overtime = detail['Ore straordinario approvate'];
    const requests = eventsForDay(data.requests, detail.employeeId, detail.Data);
    const permissionHours = dailyRequestHours(requests, detail.Data, 'permission', 'approved');
    const pendingPermission = dailyRequestHours(requests, detail.Data, 'permission', 'pending');
    const pendingOvertime = dailyRequestHours(requests, detail.Data, 'overtime', 'pending');
    const pendingHours = pendingPermission > 0 || pendingOvertime > 0;
    const codes = [];
    if (!future && summary.present && !summary.permission && overtime <= 0 && !pendingHours) codes.push('PR');
    if (summary.leave) codes.push('F');
    if (summary.permission) codes.push(permissionHours > 0 ? `P${hoursLabel(permissionHours)}` : 'P');
    if (pendingPermission > 0) codes.push(`P${hoursLabel(pendingPermission)} ◷`);
    if (detail['Malattia approvata']) codes.push('M');
    if (detail['Maternità approvata']) codes.push('MAT');
    if (!future && summary.absence) codes.push('A');
    if (unknown) codes.push('?');
    if (!future && missingSchedule) codes.push('Orario?');
    if (overtime > 0) codes.push(`STR ${hoursLabel(overtime)}${summary.separate ? ' S' : ''}`);
    if (pendingOvertime > 0) codes.push(`STR ${hoursLabel(pendingOvertime)} ◷`);
    grouped.get(detail.employeeId).push({ ...summary, unknown, future, missingSchedule, overtime, pendingHours, day: detail.Data, detail, codes, requests, pending: requests.some(row => row.status === 'pending') });
  }
  return { days, rows: [...grouped.entries()].map(([userId, cells]) => {
    const total = { present: 0, leave: 0, absence: 0, permission: 0, weekdayOvertime: 0, festiveOvertime: 0, separateOvertime: 0 };
    for (const cell of cells) {
      if (!cell.future) { total.present += Number(cell.present); total.absence += Number(cell.absence); }
      total.leave += Number(cell.leave); total.permission += Number(cell.permission);
      total[cell.separate ? 'separateOvertime' : cell.festive ? 'festiveOvertime' : 'weekdayOvertime'] += cell.overtime || 0;
    }
    return { employee: data.employees.find(row => row.user_id === userId), cells, total };
  }) };
}
export function eventDraft(data, userId, day, kind = 'overtime') {
  const shifts = data.shifts.filter(row => row.user_id === userId && row.work_date === day).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const start = kind === 'overtime' ? shifts.at(-1)?.ends_at : shifts[0]?.starts_at;
  const end = shifts.at(-1)?.ends_at;
  return { kind, starts_at: start ? timeInput(start) : `${day}T${kind === 'overtime' ? '17:00' : '08:00'}`, ends_at: end ? timeInput(end) : `${day}T17:00`, note: '', hours: '1', mode: kind === 'overtime' ? 'duration' : 'interval' };
}
export function calendarRequestPayload(userId, draft, existing, key) {
  const startsAt = romeInstant(draft.starts_at);
  const hours = Number(String(draft.hours).replace(',', '.'));
  if (draft.kind === 'overtime' && draft.mode === 'duration' && (!Number.isFinite(hours) || hours <= 0 || hours > 16)) throw new Error('Inserisci ore di straordinario maggiori di zero, fino a 16.');
  const endsAt = draft.kind === 'overtime' && draft.mode === 'duration' ? new Date(Date.parse(startsAt) + Math.round(hours * 60) * 60000).toISOString() : romeInstant(draft.ends_at);
  if (Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error('La fine deve essere successiva all’inizio.');
  if (!draft.note.trim()) throw new Error('Inserisci una motivazione.');
  return { user_id: userId, id: existing?.id || null, expected: existing ? requestVersion(existing) : null, kind: draft.kind, starts_at: startsAt, ends_at: endsAt, note: draft.note.trim(), request_key: key };
}

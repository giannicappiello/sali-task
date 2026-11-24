import { formatDisplayDate } from '../../lib/displayLocale.js';
import { monthDays, romeDay, romeInstant, formatDate, formatTime } from './hrTime.js';
import { comparePeople } from './hrPeople.js';
import { calendarDay } from './hrCalendar.js';
import { agreementForDay, separateOvertime } from './hrAgreements.js';
import {defaultPresenceEnabled,defaultPresenceDay} from './hrDefaultPresence.js';

const round = value => Math.round(value * 100) / 100;
const millis = value => Date.parse(value);
function unionMinutes(intervals, start, end) {
  const sorted = intervals.map(([a, b]) => [Math.max(a, start), Math.min(b, end)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0, until = start;
  for (const [a, b] of sorted) { total += Math.max(0, b - Math.max(a, until)); until = Math.max(until, b); }
  return total / 60000;
}
function overlaps(intervals, planned) {
  return intervals.flatMap(([a, b]) => planned.map(([c, d]) => [Math.max(a, c), Math.min(b, d)]));
}
export function attendanceExportRows(data, month, now = new Date()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Periodo non valido.');
  const rows = [], today = romeDay(now);
  for (const employee of [...data.employees].sort(comparePeople)) {
    const attendance = data.attendance.filter(a => a.user_id === employee.user_id);
    const shifts = data.shifts.filter(s => s.user_id === employee.user_id);
    const approved = data.requests.filter(r => r.user_id === employee.user_id && r.status === 'approved');
    if (!employee.active && !attendance.length && !shifts.length && !approved.length) continue;
    for (const day of monthDays(month)) {
      const next = new Date(`${day}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
      const start = millis(romeInstant(`${day}T00:00`)), end = millis(romeInstant(`${next.toISOString().slice(0, 10)}T00:00`));
      const daily = attendance.filter(a => millis(a.checkin_at) < end && (a.checkout_at ? millis(a.checkout_at) > start : +now > start));
      const assumed=defaultPresenceDay(data,employee.user_id,day);
      const automatic=defaultPresenceEnabled(data,day);
      const incomplete = !automatic && daily.some(a => !a.checkout_at);
      const actual = daily.filter(a => a.checkout_at).map(a => [millis(a.checkin_at), millis(a.checkout_at)]);
      const planned = shifts.map(s => [millis(s.starts_at), millis(s.ends_at)]);
      const plannedMinutes = unionMinutes(planned, start, end);
      const pause = shifts.filter(s => s.work_date === day).reduce((sum, s) => sum + Number(s.break_minutes || 0), 0);
      const requests = kind => approved.filter(r => r.kind === kind && millis(r.starts_at) < end && millis(r.ends_at) > start).map(r => [millis(r.starts_at), millis(r.ends_at)]);
      const leave = requests('leave'), permission = requests('permission'), overtime = requests('overtime'), illness = requests('illness'), pregnancy = requests('pregnancy');
      const absences = [...leave, ...permission, ...illness, ...pregnancy];
      const notes = [];
      if(automatic)notes.push(day>today ? 'Giorno futuro: escluso dalle presenze consuntive' : assumed?.scheduled ? 'Presenza da orario, al netto delle assenze approvate; nessuna timbratura richiesta' : 'Orario dipendente non configurato');
      if (incomplete) notes.push('Timbratura senza uscita: ore da verificare');
      if (absences.length && !plannedMinutes) notes.push('Assenze approvate senza turno: quantità da definire');
      if (!automatic && plannedMinutes && day < today && !daily.length && !absences.length) notes.push('Assenza da verificare');
      const uncovered = automatic ? 0 : day < today && plannedMinutes && !incomplete ? Math.max(0, plannedMinutes - pause - unionMinutes(overlaps([...actual, ...absences], planned), start, end)) : null;
      if (uncovered > 0 && !notes.includes('Assenza da verificare')) notes.push('Copertura del turno da verificare');
      const row = { Dipendente: employee.name, Matricola: employee.employee_code || '', Data: day,
        Giorno: formatDisplayDate(new Date(start), { timeZone: 'Europe/Rome', weekday: 'long' }),
        'Giorno futuro programmato': automatic && day > today,
        'Entrate / uscite': automatic ? (day>today ? 'Presenza prevista · giorno futuro' : assumed?.scheduled ? 'Presenza secondo orario dipendente' : 'Orario non configurato') : daily.map(a => `${formatDate(a.checkin_at)} ${formatTime(a.checkin_at)} → ${a.checkout_at ? `${formatDate(a.checkout_at)} ${formatTime(a.checkout_at)}` : 'USCITA MANCANTE'}`).join('; '),
        'Ore turno lordo': round(plannedMinutes / 60), 'Pausa prevista (min)': pause,
        'Ore presenza rilevata': automatic ? (day>today || !assumed?.scheduled ? null : round(assumed.presence_minutes/60)) : incomplete ? null : round(unionMinutes(actual, start, end) / 60),
        'Ferie approvate': leave.length ? 'Sì' : '', 'Ore ferie su turno lordo': leave.length && !plannedMinutes ? null : round(unionMinutes(overlaps(leave, planned), start, end) / 60),
        'Permessi approvati': permission.length ? 'Sì' : '', 'Ore permessi su turno lordo': permission.length && !plannedMinutes ? null : round(unionMinutes(overlaps(permission, planned), start, end) / 60),
        'Malattia approvata': illness.length ? 'Sì' : '', 'Maternità approvata': pregnancy.length ? 'Sì' : '',
        'Straordinario separato': separateOvertime(agreementForDay(data.contracts?.length ? data.contracts : data.presence_schedules, employee.user_id, day)) ? 'Sì' : 'No',
        'Ore straordinario approvate': round(unionMinutes(overtime, start, end) / 60),
        'Ore scoperte da verificare': uncovered == null ? null : round(uncovered / 60),
        'Chiusura aziendale': data.closures.filter(c => c.date_from <= day && c.date_to >= day).map(c => c.name).join('; '),
        Note: notes.join('; '),
      };
      Object.defineProperty(row,'employeeId',{value:employee.user_id});
      rows.push(row);
    }
  }
  return rows;
}

export function attendanceDaySummary(row) {
  const day = calendarDay(row.Data);
  const present = row['Ore presenza rilevata'];
  const unknown = present == null && !row['Giorno futuro programmato'];
  const absence = !unknown && !day.festive && row['Ore scoperte da verificare'] > 0;
  const overtime = row['Ore straordinario approvate'];
  const codes = [];
  if (row['Ferie approvate']) codes.push('F');
  if (row['Permessi approvati']) codes.push('P');
  if (row['Malattia approvata']) codes.push('M');
  if (row['Maternità approvata']) codes.push('MAT');
  if (absence) codes.push('A');
  if (unknown) codes.push('?');
  if (overtime > 0) codes.push(overtime.toLocaleString('it-IT', { useGrouping: 'always',  maximumFractionDigits: 2 }));
  if (!codes.length && present > 0) codes.push('PR');
  return { ...day, present: present > 0, absence, leave: Boolean(row['Ferie approvate']), permission: Boolean(row['Permessi approvati']),
    separate: row['Straordinario separato'] === 'Sì', unknown, overtime, weekdayOvertime: day.festive ? 0 : overtime, festiveOvertime: day.festive ? overtime : 0,
    value: codes.length === 1 && overtime > 0 && !unknown ? overtime : codes.join('\n'),
  };
}


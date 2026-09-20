import { companyCalendarDay } from '../src/modules/hr/companyCalendarDay.js';
import { plantTime } from '../src/pages/Dashboard/productionCalendar.js';

export function calendarProjection(row, calendar, from, to) {
  const start = plantTime(row.start), end = plantTime(row.end);
  const confirmed = Array.isArray(row.confirmedIntervals);
  const ranges = confirmed ? row.confirmedIntervals.map(i => ({ start: plantTime(i.Start ?? i.start), end: plantTime(i.End ?? i.end) })) : [{ start, end }];
  if (ranges.some(i => !i.start || i.end <= i.start || i.start < start || i.end > end)) throw new Error('Fasce della lavorazione non valide.');
  const intervals = [];
  let conflict = false;
  for (let day = from; day <= to; day = new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
    if (start >= `${day}T24:00` || end <= `${day}T00:00`) continue;
    const opening = companyCalendarDay(calendar, day);
    if (!opening || !Array.isArray(opening.intervals)) throw new Error('Calendario aziendale non disponibile per la lavorazione.');
    for (const range of ranges) {
      const left = range.start > `${day}T00:00` ? range.start : `${day}T00:00`;
      const right = range.end < `${day}T24:00` ? range.end : `${day}T24:00`;
      if (right <= left) continue;
      let covered = 0;
      for (const [a, b] of opening.intervals) {
        const slotStart = `${day}T${a}`, slotEnd = `${day}T${b}`;
        const aStart = left > slotStart ? left : slotStart, aEnd = right < slotEnd ? right : slotEnd;
        if (aEnd > aStart) {
          intervals.push({ start: aStart, end: aEnd });
          covered += Date.parse(`${aEnd}:00Z`) - Date.parse(`${aStart}:00Z`);
        }
      }
      if (confirmed && covered < Date.parse(`${right}:00Z`) - Date.parse(`${left}:00Z`)) conflict = true;
    }
  }
  return { intervals, conflict };
}

export function calendarIntervals(row, calendar, from, to) {
  return calendarProjection(row, calendar, from, to).intervals;
}

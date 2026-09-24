export const isoDate = value => new Date(`${value}T12:00:00Z`);
export const shiftDate = (value, days) => {
  const date = isoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
export const mondayOf = value => shiftDate(value, 1 - (isoDate(value).getUTCDay() || 7));
export function selectedMonthSnapshot(months, snapshots, selected) {
  const index = months.indexOf(selected);
  if (index < 0 || !snapshots[index]) throw new Error('Dati del mese selezionato non disponibili.');
  return snapshots[index];
}
export function minutesBetween(from, to) {
  const minutes = from && to ? (Date.parse(to) - Date.parse(from)) / 60000 : NaN;
  return Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes) : null;
}
export function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) return 'Non determinabile';
  const absolute = Math.round(Math.abs(minutes));
  if (minutes === 0) return '0h 00m';
  return `${minutes < 0 ? '−' : '+'}${Math.floor(absolute / 60)}h ${String(absolute % 60).padStart(2, '0')}m`;
}
export function agreementMinutes(contract, day) {
  if (!contract) return null;
  const fields = { ...contract, ...contract.agreement_fields };
  const weekdays = String(fields.weekdays ?? '').split(',').filter(value => /^[1-7]$/.test(value.trim())).map(Number);
  if (!weekdays.length) return null;
  if (!weekdays.includes(isoDate(day).getUTCDay() || 7)) return 0;
  const parseTime = value => {
    const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(value || ''));
    return match && Number(match[1]) < 24 && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const from = parseTime(fields.start_time);
  const to = parseTime(fields.end_time);
  const pause = String(fields.break_minutes ?? '').trim();
  if (from !== null && to !== null && /^\d+(?:\.\d+)?$/.test(pause)) {
    const duration = to - from + (to < from ? 1440 : 0) - Number(pause);
    return duration >= 0 ? duration : null;
  }
  const hours = String(fields.weekly_hours ?? '').trim().replace(',', '.');
  return /^\d+(?:\.\d+)?$/.test(hours) ? Number(hours) * 60 / new Set(weekdays).size : null;
}

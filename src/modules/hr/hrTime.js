export function romeDay(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
export function monthDays(month) {
  const [year, number] = month.split('-').map(Number);
  return Array.from({ length: new Date(Date.UTC(year, number, 0)).getUTCDate() }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
export function formatTime(value) { return value ? new Date(value).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }) : '—'; }
export function formatDate(value) { return value ? new Date(value).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '—'; }
export function timeInput(value) {
  return value ? `${romeDay(value)}T${formatTime(value)}` : '';
}
// datetime-local is a Rome wall clock, independent of the phone timezone.
export function romeInstant(value) {
  if (!value) throw new Error('Indica data e ora.');
  const approximate = new Date(`${value}:00Z`);
  if (!Number.isFinite(+approximate)) throw new Error('Data non valida.');
  const offset = (date) => {
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Rome', timeZoneName: 'longOffset' }).formatToParts(date);
    const match = parts.find((p) => p.type === 'timeZoneName').value.match(/GMT([+-])(\d{2}):(\d{2})/);
    return match ? (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3])) * 60000 : 0;
  };
  let date = new Date(+approximate - offset(approximate));
  date = new Date(+approximate - offset(date));
  if (timeInput(date) !== value) throw new Error('Orario inesistente nel cambio dell’ora legale.');
  return date.toISOString();
}
export function attendanceAnomaly(row, shifts, now = Date.now()) {
  if (row.checkout_at) return false;
  const shift = shifts.find((s) => s.user_id === row.user_id && s.work_date === romeDay(row.checkin_at));
  return shift ? now > Date.parse(shift.ends_at) + 30 * 60000 : now - Date.parse(row.checkin_at) > 12 * 3600000;
}

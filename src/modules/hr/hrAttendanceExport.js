import { monthDays, romeDay, romeInstant, formatDate, formatTime } from './hrTime.js';

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
  for (const employee of data.employees) {
    const attendance = data.attendance.filter(a => a.user_id === employee.user_id);
    const shifts = data.shifts.filter(s => s.user_id === employee.user_id);
    const approved = data.requests.filter(r => r.user_id === employee.user_id && r.status === 'approved');
    if (!employee.active && !attendance.length && !shifts.length && !approved.length) continue;
    for (const day of monthDays(month)) {
      const next = new Date(`${day}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
      const start = millis(romeInstant(`${day}T00:00`)), end = millis(romeInstant(`${next.toISOString().slice(0, 10)}T00:00`));
      const daily = attendance.filter(a => millis(a.checkin_at) < end && (a.checkout_at ? millis(a.checkout_at) > start : +now > start));
      const incomplete = daily.some(a => !a.checkout_at);
      const actual = daily.filter(a => a.checkout_at).map(a => [millis(a.checkin_at), millis(a.checkout_at)]);
      const planned = shifts.map(s => [millis(s.starts_at), millis(s.ends_at)]);
      const plannedMinutes = unionMinutes(planned, start, end);
      const pause = shifts.filter(s => s.work_date === day).reduce((sum, s) => sum + Number(s.break_minutes || 0), 0);
      const requests = kind => approved.filter(r => r.kind === kind && millis(r.starts_at) < end && millis(r.ends_at) > start).map(r => [millis(r.starts_at), millis(r.ends_at)]);
      const leave = requests('leave'), permission = requests('permission'), overtime = requests('overtime');
      const notes = [];
      if (incomplete) notes.push('Timbratura senza uscita: ore da verificare');
      if ((leave.length || permission.length) && !plannedMinutes) notes.push('Ferie/permessi approvati senza turno: quantità da definire');
      if (plannedMinutes && day < today && !daily.length && !leave.length && !permission.length) notes.push('Assenza da verificare');
      const uncovered = day < today && plannedMinutes && !incomplete ? Math.max(0, plannedMinutes - pause - unionMinutes(overlaps([...actual, ...leave, ...permission], planned), start, end)) : null;
      if (uncovered > 0 && !notes.includes('Assenza da verificare')) notes.push('Copertura del turno da verificare');
      const row = { Dipendente: employee.name, Matricola: employee.employee_code || '', Data: day,
        Giorno: new Date(start).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long' }),
        'Entrate / uscite': daily.map(a => `${formatDate(a.checkin_at)} ${formatTime(a.checkin_at)} → ${a.checkout_at ? `${formatDate(a.checkout_at)} ${formatTime(a.checkout_at)}` : 'USCITA MANCANTE'}`).join('; '),
        'Ore turno lordo': round(plannedMinutes / 60), 'Pausa prevista (min)': pause,
        'Ore presenza rilevata': incomplete ? null : round(unionMinutes(actual, start, end) / 60),
        'Ferie approvate': leave.length ? 'Sì' : '', 'Ore ferie su turno lordo': leave.length && !plannedMinutes ? null : round(unionMinutes(overlaps(leave, planned), start, end) / 60),
        'Permessi approvati': permission.length ? 'Sì' : '', 'Ore permessi su turno lordo': permission.length && !plannedMinutes ? null : round(unionMinutes(overlaps(permission, planned), start, end) / 60),
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

export async function createAttendanceWorkbook(data, month) {
  const XLSX = await import('xlsx');
  const rows = attendanceExportRows(data, month);
  const workbook = XLSX.utils.book_new();
  const sheet = (name, records) => {
    const ws = XLSX.utils.json_to_sheet(records);
    if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };
    ws['!cols'] = Object.keys(records[0] || {}).map(key => ({ wch: Math.min(50, Math.max(16, key.length + 2)) }));
    XLSX.utils.book_append_sheet(workbook, ws, name);
  };
  sheet('Presenze giornaliere', rows);
  const totals = new Map();
  for (const row of rows) {
    const key = row.employeeId;
    const total = totals.get(key) || { Dipendente: row.Dipendente, Matricola: row.Matricola, 'Giorni con anomalie': 0 };
    if (row.Note) total['Giorni con anomalie']++;
    for (const [field, value] of Object.entries(row)) if (field.startsWith('Ore ') && value != null) total[field] = round((total[field] || 0) + value);
    totals.set(key, total);
  }
  sheet('Riepilogo mensile', [...totals.values()]);
  const name = id => data.employees.find(e => e.user_id === id)?.name || 'Dipendente';
  sheet('Richieste', data.requests.filter(r => romeDay(r.starts_at) <= `${month}-31` && romeDay(r.ends_at) >= `${month}-01`).map(r => ({ Dipendente: name(r.user_id), Tipo: ({ leave: 'Ferie', permission: 'Permesso', overtime: 'Straordinario', correction: 'Correzione' })[r.kind], Dal: `${formatDate(r.starts_at)} ${formatTime(r.starts_at)}`, Al: `${formatDate(r.ends_at)} ${formatTime(r.ends_at)}`, Stato: ({ pending: 'In attesa', approved: 'Approvata', rejected: 'Rifiutata', cancelled: 'Annullata' })[r.status] })));
  sheet('Legenda', [
    { Voce: 'Periodo', Descrizione: `${month} · Fuso orario Europe/Rome · Ore decimali` },
    { Voce: 'Presenze', Descrizione: 'Intervalli entrata/uscita, divisi a mezzanotte e senza duplicare sovrapposizioni. Pause non sottratte: non equivalgono a ore retribuite.' },
    { Voce: 'Ferie e permessi', Descrizione: 'Solo richieste approvate. Ore sovrapposte al turno lordo, prima delle pause. Senza turno, quantità vuota da definire.' },
    { Voce: 'Straordinari', Descrizione: 'Ore approvate, da confrontare con le presenze effettive prima dell’elaborazione delle paghe.' },
    { Voce: 'Assenze', Descrizione: 'Ore del turno non coperte da presenze complete, ferie o permessi approvati: da verificare, non assenze definitive. Non calcolate per oggi/futuro o uscite mancanti.' },
    { Voce: 'Campi vuoti', Descrizione: 'Dato non determinabile. I totali sommano solo i dati disponibili; controllare i giorni con anomalie.' },
  ]);
  return workbook;
}

export async function downloadAttendanceWorkbook(data, month) {
  const XLSX = await import('xlsx');
  const workbook = await createAttendanceWorkbook(data, month);
  XLSX.writeFile(workbook, `Presenze_HR_${month}.xlsx`);
}

import { monthDays, romeDay, romeInstant, formatDate, formatTime } from './hrTime.js';
import { comparePeople } from './hrPeople.js';
import { calendarDay } from './hrCalendar.js';
import { styleAttendanceFile } from './hrWorkbookStyles.js';

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

export function attendanceDaySummary(row) {
  const day = calendarDay(row.Data);
  const present = row['Ore presenza rilevata'];
  const unknown = present == null;
  const absence = !unknown && !day.festive && row['Ore scoperte da verificare'] > 0;
  const overtime = day.festive || day.saturday ? present : row['Ore straordinario approvate'];
  const codes = [];
  if (row['Ferie approvate']) codes.push('F');
  if (row['Permessi approvati']) codes.push('P');
  if (absence) codes.push('A');
  if (unknown) codes.push('?');
  if (overtime > 0) codes.push(overtime.toLocaleString('it-IT', { maximumFractionDigits: 2 }));
  if (!codes.length && present > 0) codes.push('PR');
  return { ...day, present: present > 0, absence, leave: Boolean(row['Ferie approvate']), permission: Boolean(row['Permessi approvati']),
    unknown, overtime, weekdayOvertime: day.festive ? 0 : overtime, festiveOvertime: day.festive ? overtime : 0,
    value: codes.length === 1 && overtime > 0 && !unknown ? overtime : codes.join('\n'),
  };
}

export async function createAttendanceWorkbook(data, month, now = new Date()) {
  const XLSX = await import('xlsx');
  const rows = attendanceExportRows(data, month, now), days = monthDays(month);
  const workbook = XLSX.utils.book_new();
  const headers = ['Dipendente', 'Giorni presenza', 'Giorni ferie', 'Giorni assenza da verificare', 'Giorni permesso', 'Ore straordinario feriali totali', 'Ore straordinario festivi'];
  const company = data.company_name || [...new Set((data.sites || []).map(s => s.name).filter(Boolean))].join(' / ') || 'Azienda non configurata';
  const matrix = [
    ['Anno', '', 'Mese', '', 'Azienda'],
    [Number(month.slice(0,4)), '', new Date(`${month}-01T12:00:00Z`).toLocaleDateString('it-IT',{month:'long'}), '', company],
    [], ['Presenze mensili · F ferie · A assenza da verificare · P permesso · PR presenza · numero = ore straordinario · ? uscita mancante'],
    [...headers, ...days.map(d => Number(d.slice(-2)))],
    [...headers.map(() => ''), ...days.map(d => ['D','L','M','M','G','V','S'][calendarDay(d).weekday])],
  ];
  const grouped = new Map();
  for (const row of rows) { if (!grouped.has(row.employeeId)) grouped.set(row.employeeId, []); grouped.get(row.employeeId).push(row); }
  for (const employeeRows of grouped.values()) {
    const summary = employeeRows.map(attendanceDaySummary);
    const total = key => summary.some(s => s[key] == null) ? 'Da verificare' : round(summary.reduce((n,s) => n+s[key],0));
    matrix.push([employeeRows[0].Dipendente, ...['present','leave','absence','permission'].map(k => summary.filter(s => s[k]).length), total('weekdayOvertime'), total('festiveOvertime'), ...summary.map(s => s.value)]);
  }
  if (!grouped.size) matrix.push(['Nessun dipendente nel periodo']);
  const grid = XLSX.utils.aoa_to_sheet(matrix);
  const last = headers.length + days.length - 1;
  grid['!cols'] = [{wch:28}, ...Array.from({length:4},()=>({wch:9})), {wch:13}, {wch:13}, ...days.map(()=>({wch:5}))];
  grid['!rows'] = [{hpt:20},{hpt:30},{hpt:12},{hpt:32},{hpt:72},{hpt:22}, ...matrix.slice(6).map(()=>({hpt:42}))];
  grid['!merges'] = [0,1].flatMap(r => [{s:{r,c:0},e:{r,c:1}},{s:{r,c:2},e:{r,c:3}},{s:{r,c:4},e:{r,c:last}}]);
  grid['!merges'].push({s:{r:3,c:0},e:{r:3,c:last}}, ...headers.map((_,c)=>({s:{r:4,c},e:{r:5,c}})));
  grid['!hrStyles'] = {};
  // Explicit cells give every day its border and weekend background, even when empty.
  for(let r=0;r<matrix.length;r++) for(let c=0;c<=last;c++) {
    if(r===2) continue;
    const ref=XLSX.utils.encode_cell({r,c});
    if(!grid[ref]) grid[ref]={t:'s',v:''};
    const day=c>=headers.length ? calendarDay(days[c-headers.length]) : null;
    let style=r<=1 ? 1 : r===3 ? 15 : r<=5 ? 2 : c===0 ? 3 : c<7 ? [4,5,6,7,4,4][c-1] : 8;
    if(day && r>=4) style=day.festive ? 10 : day.saturday ? 9 : r<=5 ? 2 : 8;
    if(r>=6 && String(grid[ref].v).includes('?')) style=14;
    grid['!hrStyles'][ref]=style;
  }
  grid['!hrGrid']={lastRow:matrix.length,lastColumn:XLSX.utils.encode_col(last)};
  XLSX.utils.book_append_sheet(workbook,grid,'Presenze mensili');
  const sheet = (name, records) => {
    const ws = XLSX.utils.json_to_sheet(records);
    if(ws['!ref']) ws['!autofilter']={ref:ws['!ref']};
    ws['!cols']=Object.keys(records[0] || {}).map(key=>({wch:Math.min(55,Math.max(18,key.length+2))}));
    XLSX.utils.book_append_sheet(workbook,ws,name);
  };
  sheet('Presenze giornaliere', rows.map(row => { const s=attendanceDaySummary(row); return {...row,'Festività italiana':s.holiday,'Ore straordinario feriali totali':s.weekdayOvertime,'Ore straordinario festivi':s.festiveOvertime}; }));
  const name=id=>data.employees.find(e=>e.user_id===id)?.name || 'Dipendente';
  sheet('Richieste', [...data.requests].sort((a,b)=>comparePeople({name:name(a.user_id)},{name:name(b.user_id)})).filter(r=>romeDay(r.starts_at)<=days.at(-1) && romeDay(new Date(Date.parse(r.ends_at)-1))>=days[0]).map(r=>({Dipendente:name(r.user_id),Tipo:({leave:'Ferie',permission:'Permesso',overtime:'Straordinario',correction:'Correzione'})[r.kind],Dal:`${formatDate(r.starts_at)} ${formatTime(r.starts_at)}`,Al:`${formatDate(r.ends_at)} ${formatTime(r.ends_at)}`,Stato:({pending:'In attesa',approved:'Approvata',rejected:'Rifiutata',cancelled:'Annullata'})[r.status]})));
  sheet('Legenda', [
    {Voce:'Periodo',Descrizione:`${month} · Fuso Europe/Rome · Ore decimali. Esportato il ${formatDate(now)}.`},
    {Voce:'Codici giornalieri',Descrizione:'F ferie approvate; P permesso approvato; A turno non interamente coperto, assenza da verificare; PR presenza; numero = ore straordinario; ? timbratura senza uscita.'},
    {Voce:'Straordinario feriale',Descrizione:'Somma delle ore di straordinario approvate dal lunedì al venerdì e delle ore di presenza del sabato. Escluse le festività nazionali.'},
    {Voce:'Straordinario festivo',Descrizione:'Ore di presenza nelle domeniche e nelle festività nazionali italiane. Una festività di sabato è conteggiata solo qui.'},
    {Voce:'Calendario',Descrizione:'Sabati viola; domeniche e festività nazionali rosse. Pasqua e Pasquetta variabili; San Francesco (4 ottobre) dal 2026. Feste patronali locali non incluse.'},
    {Voce:'Presenze',Descrizione:'Intervalli completi, suddivisi a mezzanotte, senza duplicare sovrapposizioni. Le pause non timbrate non sono sottratte dalle ore di presenza.'},
    {Voce:'Riepiloghi',Descrizione:'Giorni con almeno una presenza, ferie, permesso o assenza: giornate anche parziali, quindi non sommabili tra loro. I dettagli orari sono nel foglio Presenze giornaliere.'},
    {Voce:'Dati incompleti',Descrizione:'Un’uscita mancante non genera A o ore zero; nei totali interessati compare Da verificare. Celle vuote: nessun evento. Le ore approvate vanno confrontate con le presenze prima delle paghe.'},
    {Voce:'Assenze',Descrizione:'Calcolate solo sui turni passati, escludendo festività nazionali e uscite mancanti. A comprende coperture parziali; verificare il dettaglio prima delle paghe.'},
    {Voce:'Festività nazionali',Descrizione:'https://presidenza.governo.it/ufficio_cerimoniale/cerimoniale/giornate.html'},
    {Voce:'San Francesco dal 2026',Descrizione:'Legge 8 ottobre 2025 n.151: https://www.gazzettaufficiale.it/eli/id/2025/10/10/25G00153/sg'},
  ]);
  workbook.Sheets.Legenda['!cols']=[{wch:28},{wch:110}];
  return workbook;
}

export async function attendanceWorkbookBytes(workbook) {
  const XLSX=await import('xlsx');
  return styleAttendanceFile(XLSX.write(workbook,{type:'array',bookType:'xlsx'}),workbook);
}

export async function downloadAttendanceWorkbook(data, month) {
  const workbook=await createAttendanceWorkbook(data,month);
  const bytes=await attendanceWorkbookBytes(workbook);
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link=document.createElement('a'); link.href=url; link.download=`Presenze_HR_${month}.xlsx`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

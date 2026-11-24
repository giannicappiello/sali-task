import { monthDays, romeDay, formatDate, formatTime } from './hrTime.js';
import { comparePeople } from './hrPeople.js';
import { calendarDay } from './hrCalendar.js';
import { agreementForDay } from './hrAgreements.js';
import { attendanceExportRows, attendanceDaySummary } from './hrAttendanceRows.js';
export { attendanceExportRows, attendanceDaySummary } from './hrAttendanceRows.js';
import { monthlyAttendance, attendanceCodeClass } from './hrMonthlyGrid.js';
const round = value => Math.round(value * 100) / 100;
import { styleAttendanceFile } from './hrWorkbookStyles.js';

export async function createAttendanceWorkbook(data, month, now = new Date()) {
  const XLSX = await import('xlsx');
  const rows = attendanceExportRows(data, month, now), days = monthDays(month);
  const workbook = XLSX.utils.book_new();
  const headers = ['Dipendente', 'Giorni presenza', 'Giorni ferie', 'Giorni assenza da verificare', 'Giorni permesso', 'Ore straordinario feriali totali', 'Ore straordinario festivi', 'Di cui ore separate approvate', 'Di cui ore in attesa'];
  const company = data.company_name || [...new Set((data.sites || []).map(s => s.name).filter(Boolean))].join(' / ') || 'Azienda non configurata';
  const matrix = [
    ['Anno', '', 'Mese', '', 'Azienda'],
    [Number(month.slice(0,4)), '', new Date(`${month}-01T12:00:00Z`).toLocaleDateString('it-IT',{month:'long'}), '', company],
    [], ['PR presenza · P2 permesso 2 ore · STR 1 straordinario 1 ora · S gestione separata · Totali = ore indicate nei giorni, incluse separate e in attesa (◷, non approvate). Giorni futuri: Prev., esclusi dalle presenze.'],
    [...headers, ...days.map(d => Number(d.slice(-2)))],
    [...headers.map(() => ''), ...days.map(d => ['D','L','M','M','G','V','S'][calendarDay(d).weekday])],
  ];
  const grouped = new Map();
  for (const row of rows) { if (!grouped.has(row.employeeId)) grouped.set(row.employeeId, []); grouped.get(row.employeeId).push(row); }
  for (const { employee, cells, total } of monthlyAttendance(data, month, now).rows) {
    matrix.push([employee.name, ...['present','leave','absence','permission'].map(key => total[key]), round(total.weekdayOvertime), round(total.festiveOvertime), round(total.separateOvertime), round(total.pendingOvertime), ...cells.map(cell => [...cell.codes, ...(cell.future ? ['Prev.'] : []), ...(cell.pending && !cell.pendingHours ? ['◷'] : [])].join('\n'))]);
  }
  if (!grouped.size) matrix.push(['Nessun dipendente nel periodo']);
  const grid = XLSX.utils.aoa_to_sheet(matrix);
  const last = headers.length + days.length - 1;
  grid['!cols'] = [{wch:28}, ...Array.from({length:4},()=>({wch:9})), ...Array.from({length:4},()=>({wch:14})), ...days.map(()=>({wch:13}))];
  grid['!rows'] = [{hpt:20},{hpt:30},{hpt:12},{hpt:32},{hpt:72},{hpt:22}, ...matrix.slice(6).map(row=>({hpt:Math.max(42,12+12*Math.max(...row.map((value,index)=>String(value ?? '').split('\n').reduce((lines,line)=>lines+Math.max(1,Math.ceil(line.length/(index===0?28:13))),0))))}))];
  grid['!merges'] = [0,1].flatMap(r => [{s:{r,c:0},e:{r,c:1}},{s:{r,c:2},e:{r,c:3}},{s:{r,c:4},e:{r,c:last}}]);
  grid['!merges'].push({s:{r:3,c:0},e:{r:3,c:last}}, ...headers.map((_,c)=>({s:{r:4,c},e:{r:5,c}})));
  grid['!hrStyles'] = {};
  // Explicit cells give every day its border and weekend background, even when empty.
  for(let r=0;r<matrix.length;r++) for(let c=0;c<=last;c++) {
    if(r===2) continue;
    const ref=XLSX.utils.encode_cell({r,c});
    if(!grid[ref]) grid[ref]={t:'s',v:''};
    const day=c>=headers.length ? calendarDay(days[c-headers.length]) : null;
    let style=r<=1 ? 1 : r===3 ? 15 : r<=5 ? 2 : c===0 ? 3 : c<headers.length ? [4,5,6,7,4,4,4,4][c-1] : 8;
    if(day && r>=4) style=day.festive ? 10 : day.saturday ? 9 : r<=5 ? 2 : 8;
    if(r>=6 && String(grid[ref].v).includes('?')) style=14;
    if (r>=6 && c>=headers.length) { const codes=String(grid[ref].v).split('\n').map(attendanceCodeClass); if(codes.includes('hr-code-absence')) style=16; else if(codes.includes('hr-code-overtime')) style=17; }
    grid['!hrStyles'][ref]=style;
  }
  grid['!hrGrid']={lastRow:matrix.length,lastColumn:XLSX.utils.encode_col(last),firstDayColumn:headers.length};
  XLSX.utils.book_append_sheet(workbook,grid,'Presenze mensili');
  const sheet = (name, records) => {
    const ws = XLSX.utils.json_to_sheet(records);
    if(ws['!ref']) ws['!autofilter']={ref:ws['!ref']};
    ws['!cols']=Object.keys(records[0] || {}).map(key=>({wch:Math.min(55,Math.max(18,key.length+2))}));
    XLSX.utils.book_append_sheet(workbook,ws,name);
  };
  sheet('Presenze giornaliere', rows.map(row => { const s=attendanceDaySummary(row); return {...row,'Festività italiana':s.holiday,'Ore straordinario feriali totali':s.separate ? 0 : s.weekdayOvertime,'Ore straordinario festivi':s.separate ? 0 : s.festiveOvertime,'Ore straordinario feriali separate':s.separate ? s.weekdayOvertime : 0,'Ore straordinario festive separate':s.separate ? s.festiveOvertime : 0}; }));
  const separateRows = [...grouped.values()].filter(employeeRows => employeeRows.some(row => row['Straordinario separato'] === 'Sì')).map(employeeRows => {
    const summaries = employeeRows.map(attendanceDaySummary);
    const separate = summaries.filter(s => s.separate);
    const total = key => separate.some(s => s[key] == null) ? 'Da verificare' : round(separate.reduce((n,s) => n+s[key],0));
    return { Dipendente: employeeRows[0].Dipendente, Matricola: employeeRows[0].Matricola,
      'Ore straordinario feriali separate': total('weekdayOvertime'), 'Ore straordinario festive separate': total('festiveOvertime'),
      ...Object.fromEntries(employeeRows.map((row,i) => [row.Data, !summaries[i].separate ? '' : summaries[i].overtime == null ? 'Da verificare' : summaries[i].overtime])),
    };
  });
  if (separateRows.length) sheet('Straordinari separati', separateRows);
  const visibleIds = new Set(data.employees.map(employee => employee.user_id));
  const name=id=>data.employees.find(e=>e.user_id===id)?.name || 'Dipendente';
  sheet('Richieste', data.requests.filter(request => visibleIds.has(request.user_id)).sort((a,b)=>comparePeople({name:name(a.user_id)},{name:name(b.user_id)})).filter(r=>romeDay(r.starts_at)<=days.at(-1) && romeDay(new Date(Date.parse(r.ends_at)-1))>=days[0]).map(r=>({Dipendente:name(r.user_id),Tipo:({leave:'Ferie',permission:'Permesso',illness:'Malattia',pregnancy:'Maternità',overtime:'Straordinario',correction:'Correzione'})[r.kind],Dal:`${formatDate(r.starts_at)} ${formatTime(r.starts_at)}`,Al:`${formatDate(r.ends_at)} ${formatTime(r.ends_at)}`,Stato:({pending:'In attesa',approved:'Approvata',rejected:'Rifiutata',cancelled:'Annullata'})[r.status]})));
  sheet('Legenda', [
    {Voce:'Periodo',Descrizione:`${month} · Fuso Europe/Rome · Ore decimali. Esportato il ${formatDate(now)}.`},
    {Voce:'Codici giornalieri',Descrizione:'F ferie approvate; P permesso approvato; M malattia; MAT maternità; S straordinario gestito separatamente; A turno non interamente coperto, assenza da verificare; PR presenza; STR 1 = un’ora straordinaria; P2 = due ore di permesso; ◷ = richiesta in attesa, non approvata; Prev. = giorno futuro.'},
    {Voce:'Gestione separata',Descrizione:'Le colonne riepilogative del prospetto sommano tutte le ore esposte nelle giornate. La quota approvata gestita separatamente è indicata anche in Di cui ore separate approvate. I dettagli ordinari e il foglio Straordinari separati mantengono distinte le quote per le paghe.'},
    {Voce:'Straordinario feriale',Descrizione:'Somma delle ore di straordinario approvate dal lunedì al venerdì anche di sabato. Escluse le festività nazionali.'},
    {Voce:'Straordinario festivo',Descrizione:'Ore di straordinario approvate nelle domeniche e nelle festività nazionali italiane. Una festività di sabato è conteggiata solo qui.'},
    {Voce:'Calendario',Descrizione:'Sabati viola; domeniche e festività nazionali rosse. Pasqua e Pasquetta variabili; San Francesco (4 ottobre) dal 2026. Feste patronali locali non incluse.'},
    {Voce:'Presenze',Descrizione:'Intervalli completi, suddivisi a mezzanotte, senza duplicare sovrapposizioni. Le pause non timbrate non sono sottratte dalle ore di presenza.'},
    {Voce:'Riepiloghi',Descrizione:'Giorni con almeno una presenza, ferie, permesso o assenza: giornate anche parziali, quindi non sommabili tra loro. I dettagli orari sono nel foglio Presenze giornaliere.'},
    {Voce:'Dati incompleti',Descrizione:'Le ore di straordinario approvate sono sommabili anche se la presenza è da verificare. Le anomalie restano indicate nelle giornate e nei dettagli. Le ore in attesa sono distinte e non sono approvate. Confrontare sempre presenze e richieste prima delle paghe.'},
    {Voce:'Assenze',Descrizione:'Calcolate solo sui turni passati, escludendo festività nazionali e uscite mancanti. A comprende coperture parziali; verificare il dettaglio prima delle paghe.'},
    {Voce:'Festività nazionali',Descrizione:'https://presidenza.governo.it/ufficio_cerimoniale/cerimoniale/giornate.html'},
    {Voce:'San Francesco dal 2026',Descrizione:'Legge 8 ottobre 2025 n.151: https://www.gazzettaufficiale.it/eli/id/2025/10/10/25G00153/sg'},
  ]);
  workbook.Sheets.Legenda['!cols']=[{wch:28},{wch:110}];
  return workbook;
}

export const exportDate = day => day.slice(0, 10).split('-').reverse().join('-');

export async function createMonthlyAttendanceWorkbook(data, month, now = new Date()) {
  const XLSX = await import('xlsx');
  const full = await createAttendanceWorkbook(data, month, now);
  const book = XLSX.utils.book_new(), grid = full.Sheets['Presenze mensili'];
  monthDays(month).forEach((day, i) => {
    grid[XLSX.utils.encode_cell({r:4,c:i+grid['!hrGrid'].firstDayColumn})] = {t:'s',v:exportDate(day)};
    grid['!cols'][i+grid['!hrGrid'].firstDayColumn] = {wch:12};
  });
  XLSX.utils.book_append_sheet(book, grid, 'Presenze mensili');
  return book;
}

export async function createManagedOvertimeWorkbook(data, month, now = new Date()) {
  const XLSX = await import('xlsx');
  const days = monthDays(month), grouped = new Map();
  for (const row of attendanceExportRows(data, month, now)) {
    const summary = attendanceDaySummary(row);
    if (!summary.separate) continue;
    if (!grouped.has(row.employeeId)) grouped.set(row.employeeId, {
      name:row.Dipendente, code:row.Matricola, weekday:0, festive:0, amount:0, missing:false, incomplete:false, daily:{},
    });
    const item = grouped.get(row.employeeId);
    item.incomplete ||= summary.unknown;
    for (const [key, value] of [['weekday',summary.weekdayOvertime],['festive',summary.festiveOvertime]])
      item[key] = item[key] == null || value == null ? null : item[key] + value;
    item.daily[exportDate(row.Data)] = summary.overtime == null ? 'Da verificare' : summary.overtime;
    const c = agreementForDay(data.contracts, row.employeeId, row.Data);
    if (summary.overtime == null) item.missing = true;
    else if (summary.overtime > 0) {
      if (typeof c?.overtime_rate !== 'number' || !Number.isFinite(c.overtime_rate) || typeof c?.overtime_percent !== 'number' || !Number.isFinite(c.overtime_percent)) item.missing = true;
      else item.amount += summary.overtime * c.overtime_rate * (1 + c.overtime_percent / 100);
    }
  }
  const headers = ['Dipendente','Matricola','Dal','Al','Ore feriali','Ore festive','Ore totali','Valorizzazione EUR','Verifica presenze',...days.map(exportDate)];
  const records = [...grouped.values()].map(item => ({
    Dipendente:item.name, Matricola:item.code, Dal:exportDate(days[0]), Al:exportDate(days.at(-1)),
    'Ore feriali':item.weekday == null ? 'Da verificare' : round(item.weekday),
    'Ore festive':item.festive == null ? 'Da verificare' : round(item.festive),
    'Ore totali':item.weekday == null || item.festive == null ? 'Da verificare' : round(item.weekday+item.festive),
    'Valorizzazione EUR':item.missing ? 'Da definire' : round(item.amount),
    'Verifica presenze':item.incomplete ? 'Da verificare' : '',
    ...Object.fromEntries(days.map(day => [exportDate(day),item.daily[exportDate(day)] ?? ''])),
  }));
  const sheet = XLSX.utils.json_to_sheet(records, {header:headers});
  sheet['!cols'] = headers.map((_,i) => ({wch:i===0?28:i===7?22:14}));
  sheet['!autofilter'] = {ref:sheet['!ref']};
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,sheet,'Straordinario gestito');
  return book;
}

export async function attendanceWorkbookBytes(workbook) {
  const XLSX=await import('xlsx');
  return styleAttendanceFile(XLSX.write(workbook,{type:'array',bookType:'xlsx'}),workbook);
}

export async function downloadAttendanceWorkbook(data, month) {
  return downloadHrWorkbook(await createMonthlyAttendanceWorkbook(data,month), `Presenze_HR_${month.split('-').reverse().join('-')}.xlsx`);
}

export async function downloadManagedOvertimeWorkbook(data, month) {
  return downloadHrWorkbook(await createManagedOvertimeWorkbook(data,month), `Straordinario_gestito_${month.split('-').reverse().join('-')}.xlsx`);
}

async function downloadHrWorkbook(workbook, filename) {
  const bytes=await attendanceWorkbookBytes(workbook);
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const link=document.createElement('a'); link.href=url; link.download=filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

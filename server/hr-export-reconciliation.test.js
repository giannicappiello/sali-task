import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import PizZip from 'pizzip';
import { monthDays, romeInstant } from '../src/modules/hr/hrTime.js';
import { monthlyAttendance } from '../src/modules/hr/hrMonthlyGrid.js';
import { createMonthlyAttendanceWorkbook, createAttendanceWorkbook, createManagedOvertimeWorkbook, attendanceWorkbookBytes } from '../src/modules/hr/hrAttendanceExport.js';

const now = new Date('2026-11-24T12:00:00Z');
export function reconciliationFixture() {
  const employees = [{ user_id: 'a', name: 'Anna prova', active: true }, { user_id: 'b', name: 'Bruno prova', active: true }];
  const contracts = employees.flatMap(e => [{ user_id: e.user_id, effective_from: '2026-01-01', weekdays: [1,2,3,4,5], overtime_separate: false }, ...(e.user_id === 'a' ? [{ user_id: 'a', effective_from: '2026-11-24', weekdays: [1,2,3,4,5], overtime_separate: true, overtime_rate: 10, overtime_percent: 25 }] : [])]);
  const request = (kind, from, to, status = 'approved') => ({ user_id: 'a', kind, starts_at: romeInstant(from), ends_at: romeInstant(to), status });
  const approved = request('overtime', '2026-11-24T17:00', '2026-11-24T19:30');
  return { employees, contracts, presence_schedules: contracts, attendance: [], shifts: employees.flatMap(e => monthDays('2026-11').filter(day => ![0,6].includes(new Date(`${day}T12:00Z`).getUTCDay())).map(day => ({ user_id: e.user_id, work_date: day, starts_at: romeInstant(`${day}T08:00`), ends_at: romeInstant(`${day}T17:00`), break_minutes: 60 }))), closures: [], requests: [approved, {...approved}, request('overtime','2026-11-14T08:00','2026-11-14T10:00'), request('overtime','2026-11-15T08:00','2026-11-15T11:00'), request('overtime','2026-11-24T19:30','2026-11-24T20:30','pending'), request('overtime','2026-11-25T17:00','2026-11-25T18:30'), request('overtime','2026-11-29T08:00','2026-11-29T09:15','pending'), request('permission','2026-11-24T09:00','2026-11-24T11:00'), request('overtime','2026-11-24T21:00','2026-11-24T22:00','rejected')], attendance_policy: { mode: 'default_present', effective_from: '2026-11-01' } };
}

test('current-month saved Excel reconciles every daily reference to UI totals, including separate and pending hours', async () => {
  const data = reconciliationFixture(), ui = monthlyAttendance(data,'2026-11',now);
  const book = await createMonthlyAttendanceWorkbook(data,'2026-11',now);
  const bytes = await attendanceWorkbookBytes(book), saved = XLSX.read(bytes,{type:'array'}), sheet = saved.Sheets['Presenze mensili'];
  assert.equal(sheet.F7.t,'n'); assert.equal(sheet.F7.v,7); assert.equal(sheet.G7.v,4.25);
  assert.equal(sheet.H7.v,4); assert.equal(sheet.I7.v,2.25);
  assert.equal(sheet.B7.v,17); assert.equal(sheet.F8.v,0); assert.equal(sheet.G8.v,0);
  assert.equal(sheet.J5.v,'01-11-2026'); assert.equal(sheet.AM5.v,'30-11-2026');
  for (let i=0;i<ui.rows.length;i++) {
    const row = ui.rows[i], excelRow=i+6;
    let dailySum=0;
    row.cells.forEach((cell,j) => {
      const text=sheet[XLSX.utils.encode_cell({r:excelRow,c:j+9})].v;
      assert.equal(String(text).includes('◷'),cell.pending);
      assert.ok(!String(text).includes('?') || cell.codes.some(code=>code.includes('?')));
      for(const match of String(text).matchAll(/STR ([\d,]+)/g)) dailySum+=Number(match[1].replace(',','.'));
      assert.ok(!cell.future || String(text).includes('Prev.'));
    });
    assert.equal(Math.round(dailySum*100)/100, sheet[`F${excelRow+1}`].v+sheet[`G${excelRow+1}`].v);
    assert.equal(sheet[`F${excelRow+1}`].v,row.total.weekdayOvertime);
    assert.equal(sheet[`G${excelRow+1}`].v,row.total.festiveOvertime);
  }
  const zip=new PizZip(bytes),xml=zip.file('xl/worksheets/sheet1.xml').asText();
  assert.match(xml,/xSplit="9".*topLeftCell="J7"/);
  assert.match(xml,/orientation="landscape"/);
});

test('ordinary payroll detail and separate valuation retain approved-only amounts while pending remains visible in roster', async () => {
  const data = reconciliationFixture();
  const full=await createAttendanceWorkbook(data,'2026-11',now);
  const detail=XLSX.utils.sheet_to_json(full.Sheets['Presenze giornaliere']);
  assert.equal(detail.filter(r=>r.Dipendente==='Anna prova').reduce((n,r)=>n+r['Ore straordinario approvate'],0),9);
  assert.equal(detail.filter(r=>r.Dipendente==='Anna prova').reduce((n,r)=>n+r['Ore straordinario feriali totali'],0),2);
  const managed=await createManagedOvertimeWorkbook(data,'2026-11',now);
  const record=XLSX.utils.sheet_to_json(managed.Sheets['Straordinario gestito'])[0];
  assert.equal(record['Ore totali'],4); assert.equal(record['Valorizzazione EUR'],50);
  assert.equal(record['25-11-2026'],1.5); assert.equal(record['29-11-2026'],0);
});

test('personal schedules carry the non-economic separate flag and text exports exclude employees outside the supplied roster', async () => {
  const data=reconciliationFixture(); data.contracts=[];
  assert.equal(monthlyAttendance(data,'2026-11',now).rows[0].total.separateOvertime,4);
  data.requests.push({ user_id:'outside',kind:'overtime',status:'approved',starts_at:romeInstant('2026-11-24T17:00'),ends_at:romeInstant('2026-11-24T18:00') });
  const full=await createAttendanceWorkbook(data,'2026-11',now);
  assert.ok(XLSX.utils.sheet_to_json(full.Sheets.Richieste).every(row=>row.Dipendente!=='Dipendente'));
});

test('calendar headers, pane split and exact day counts survive February and leap years',async()=>{
  for(const [month,count] of [['2026-02',28],['2028-02',29],['2026-12',31]]) {
    const data=reconciliationFixture(); data.requests=[];
    const sheet=(await createMonthlyAttendanceWorkbook(data,month,now)).Sheets['Presenze mensili'];
    assert.equal(sheet['!hrGrid'].firstDayColumn,9);
    assert.equal(XLSX.utils.decode_range(sheet['!ref']).e.c+1,9+count);
    assert.equal(sheet[XLSX.utils.encode_cell({r:4,c:8+count})].v,`${count}-${month.slice(5)}-${month.slice(0,4)}`);
  }
});

test('Excel absence cells are red and overtime cells blue, including mixed-day rich text',async()=>{
  const data=reconciliationFixture();
  const book=await createMonthlyAttendanceWorkbook(data,'2026-11',now),sheet=book.Sheets['Presenze mensili'];
  assert.equal(sheet['!hrStyles'].W7,17); // Overtime on Saturday 14th overrides weekend fill.
  assert.equal(sheet['!hrStyles'].AG7,16); // Permission + overtime on 24th.
  const bytes=await attendanceWorkbookBytes(book),zip=new PizZip(bytes);
  const xml=zip.file('xl/worksheets/sheet1.xml').asText(),styles=zip.file('xl/styles.xml').asText();
  assert.match(styles,/FFFFE1E1/);assert.match(styles,/FFD9F2FF/);
  assert.match(xml,/<c r="AG7"[^>]*t="inlineStr"><is>.*?FFB42318[\s\S]*?FF006A99/);
  const saved=XLSX.read(bytes,{type:'array'});
  assert.match(saved.Sheets['Presenze mensili'].AG7.v,/P2\nSTR 2,5 S\nSTR 1 ◷/);
});

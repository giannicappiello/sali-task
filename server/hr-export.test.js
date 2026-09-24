import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { attendanceExportRows, createAttendanceWorkbook, attendanceWorkbookBytes, attendanceDaySummary } from '../src/modules/hr/hrAttendanceExport.js';
import { calendarDay } from '../src/modules/hr/hrCalendar.js';
import { sortHrPeople } from '../src/modules/hr/hrPeople.js';
import PizZip from 'pizzip';

const data = () => ({ employees: [{ user_id: 'e', name: '=Nome test', employee_code: '1', active: true }], attendance: [], shifts: [], requests: [], closures: [] });
const now = new Date('2026-10-01T12:00:00Z');
test('export splits overnight presence and merges duplicate intervals', () => {
  const d = data();
  const a = { user_id: 'e', checkin_at: '2026-09-01T20:00:00Z', checkout_at: '2026-09-02T04:00:00Z' };
  d.attendance = [a, a];
  const rows = attendanceExportRows(d, '2026-09', now);
  assert.equal(rows[0]['Ore presenza rilevata'], 2);
  assert.equal(rows[1]['Ore presenza rilevata'], 6);
});
test('export distinguishes approved leave, pending requests and incomplete punches', () => {
  const d = data();
  d.shifts = [{ user_id:'e',work_date:'2026-09-01',starts_at:'2026-09-01T06:00:00Z',ends_at:'2026-09-01T15:00:00Z',break_minutes:60 }];
  d.requests = [{ user_id:'e',kind:'leave',status:'approved',starts_at:'2026-09-01T06:00:00Z',ends_at:'2026-09-01T15:00:00Z' }, { user_id:'e',kind:'overtime',status:'pending',starts_at:'2026-09-01T15:00:00Z',ends_at:'2026-09-01T16:00:00Z' }];
  let row = attendanceExportRows(d,'2026-09',now)[0];
  assert.equal(row['Ore ferie su turno lordo'],9);
  assert.equal(row['Ore scoperte da verificare'],0);
  assert.equal(row['Ore straordinario approvate'],0);
  d.requests=[];
  row=attendanceExportRows(d,'2026-09',now)[0];
  assert.equal(row['Ore scoperte da verificare'],8);
  assert.match(row.Note,/Assenza da verificare/);
  d.attendance=[{user_id:'e',checkin_at:'2026-09-01T06:00:00Z',checkout_at:null}];
  row=attendanceExportRows(d,'2026-09',now)[0];
  assert.equal(row['Ore presenza rilevata'],null);
  assert.equal(row['Ore scoperte da verificare'],null);
  assert.match(row.Note,/senza uscita/);
});
test('generated Excel preserves text as text and contains daily and summary sheets', async () => {
  const workbook = await createAttendanceWorkbook(data(),'2026-09');
  const bytes=await attendanceWorkbookBytes(workbook);
  const saved = XLSX.read(bytes,{type:'array'});
  assert.deepEqual(saved.SheetNames,['Presenze mensili','Presenze giornaliere','Richieste','Legenda']);
  assert.equal(saved.Sheets['Presenze giornaliere'].A2.t,'s');
  assert.equal(saved.Sheets['Presenze giornaliere'].A2.v,'=Nome test');
  assert.equal(saved.Sheets['Presenze giornaliere'].A2.f,undefined);
  assert.equal(XLSX.utils.sheet_to_json(saved.Sheets['Presenze giornaliere']).length,30);
  assert.equal(saved.Sheets['Presenze mensili'].A7.v,'=Nome test');
  assert.equal(saved.Sheets['Presenze mensili'].A7.f,undefined);
  const zip=new PizZip(bytes),xml=zip.file('xl/worksheets/sheet1.xml').asText();
  assert.match(xml,/state="frozen"/);
  assert.match(xml,/orientation="landscape"/);
  assert.ok(xml.indexOf('<pageSetup')<xml.indexOf('<ignoredErrors>'));
  assert.match(xml,/<c r="M7"[^>]*s="10"/); // Sunday 6 September
  assert.match(zip.file('xl/styles.xml').asText(),/FFE12D39/);
  assert.equal(saved.Sheets['Presenze mensili'].F5.v,'Ore straordinario feriali totali');
});

test('calendar distinguishes Easter, Saturday holidays and the new October holiday',()=>{
  assert.equal(calendarDay('2026-04-06').holiday,'Lunedì dell’Angelo');
  assert.equal(calendarDay('2027-03-29').holiday,'Lunedì dell’Angelo');
  assert.equal(calendarDay('2026-08-15').saturday,true);
  assert.equal(calendarDay('2026-08-15').festive,true);
  assert.equal(calendarDay('2025-10-04').holiday,'');
  assert.equal(calendarDay('2026-10-04').holiday,'San Francesco d’Assisi');
});

test('monthly totals count weekday overtime and weekend presence once, preserve unknown data and F/P/A codes',async()=>{
  const d=data();
  for(const [day,hours] of [['2026-08-14',10],['2026-08-15',5],['2026-08-16',4],['2026-08-22',6]]) {
    d.attendance.push({user_id:'e',checkin_at:`${day}T06:00:00Z`,checkout_at:`${day}T${String(6+hours).padStart(2,'0')}:00:00Z`});
    d.requests.push({user_id:'e',kind:'overtime',status:'approved',starts_at:`${day}T06:00:00Z`,ends_at:`${day}T08:00:00Z`});
  }
  const workbook=await createAttendanceWorkbook(d,'2026-08',now),ws=workbook.Sheets['Presenze mensili'];
  assert.equal(ws.F7.v,8); // 2 approved Friday + 6 actual Saturday
  assert.equal(ws.G7.v,9); // Saturday holiday 5 + Sunday 4, no duplicate approved overtime
  const row=attendanceExportRows(d,'2026-08',now)[0];
  assert.equal(attendanceDaySummary({...row,'Ferie approvate':'Sì','Permessi approvati':'Sì'}).value,'F\nP');
  assert.equal(attendanceDaySummary({...row,'Ore scoperte da verificare':8}).value,'A');
  assert.equal(attendanceDaySummary({...row,'Ore presenza rilevata':null,'Ore scoperte da verificare':8}).value,'?');
  d.attendance.push({user_id:'e',checkin_at:'2026-08-23T06:00:00Z',checkout_at:null});
  assert.equal((await createAttendanceWorkbook(d,'2026-08',now)).Sheets['Presenze mensili'].G7.v,'Da verificare');
});

test('all employee lists use the same Italian alphabetical order without mutating source arrays',()=>{
  const employees=[{user_id:'z',name:'Zeno'},{user_id:'a',name:'Anna'},{user_id:'e',name:'Élia'}];
  const sorted=sortHrPeople({employees,users:employees.map(e=>({id:e.user_id,name:e.name})),recipients:['z','e','a'],requests:[{user_id:'z'},{user_id:'a'}]});
  assert.deepEqual(sorted.employees.map(e=>e.name),['Anna','Élia','Zeno']);
  assert.deepEqual(sorted.recipients,['a','e','z']);
  assert.deepEqual(sorted.requests.map(e=>e.user_id),['a','z']);
  assert.equal(employees[0].name,'Zeno');
});

test('separate overtime follows agreement dates, excludes ordinary totals and preserves daily hours',async()=>{
  const d=data();
  d.contracts=[{id:'old',user_id:'e',effective_from:'2026-01-01',overtime_separate:false},{id:'new',user_id:'e',effective_from:'2026-08-15',overtime_separate:true}];
  for(const [day,hours] of [['2026-08-14',10],['2026-08-15',5],['2026-08-16',4],['2026-08-22',6]]) {
    d.attendance.push({user_id:'e',checkin_at:day+'T06:00:00Z',checkout_at:day+'T'+String(6+hours).padStart(2,'0')+':00:00Z'});
    d.requests.push({user_id:'e',kind:'overtime',status:'approved',starts_at:day+'T06:00:00Z',ends_at:day+'T08:00:00Z'});
  }
  const book=await createAttendanceWorkbook(d,'2026-08',now);
  assert.equal(book.Sheets['Presenze mensili'].F7.v,2);
  assert.equal(book.Sheets['Presenze mensili'].G7.v,0);
  const separate=XLSX.utils.sheet_to_json(book.Sheets['Straordinari separati'])[0];
  assert.equal(separate['Ore straordinario feriali separate'],6);
  assert.equal(separate['Ore straordinario festive separate'],9);
  assert.equal(separate['2026-08-14'],'');
  assert.equal(separate['2026-08-15'],5);
  const daily=XLSX.utils.sheet_to_json(book.Sheets['Presenze giornaliere']).find(r=>r.Data==='2026-08-15');
  assert.equal(daily['Ore presenza rilevata'],5);
  assert.equal(daily['Ore straordinario festivi'],0);
  assert.equal(daily['Ore straordinario festive separate'],5);
  d.attendance.push({user_id:'e',checkin_at:'2026-08-23T06:00:00Z',checkout_at:null});
  const unknown=await createAttendanceWorkbook(d,'2026-08',now);
  assert.equal(unknown.Sheets['Presenze mensili'].G7.v,0);
  assert.equal(XLSX.utils.sheet_to_json(unknown.Sheets['Straordinari separati'])[0]['Ore straordinario festive separate'],'Da verificare');
  const saved=XLSX.read(await attendanceWorkbookBytes(book),{type:'array'});
  assert.ok(saved.SheetNames.includes('Straordinari separati'));
});
test('approved illness and maternity cover shifts without becoming unexplained absence',()=>{
  for(const kind of ['illness','pregnancy']) {
    const d=data();
    d.shifts=[{user_id:'e',work_date:'2026-09-01',starts_at:'2026-09-01T06:00:00Z',ends_at:'2026-09-01T15:00:00Z',break_minutes:60}];
    d.requests=[{user_id:'e',kind,status:'approved',starts_at:'2026-09-01T06:00:00Z',ends_at:'2026-09-01T15:00:00Z'}];
    const row=attendanceExportRows(d,'2026-09',now)[0];
    assert.equal(row['Ore scoperte da verificare'],0);
    assert.equal(attendanceDaySummary(row).value,kind==='illness'?'M':'MAT');
  }
});

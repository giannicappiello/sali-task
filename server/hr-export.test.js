import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { attendanceExportRows, createAttendanceWorkbook } from '../src/modules/hr/hrAttendanceExport.js';

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
  const saved = XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
  assert.deepEqual(saved.SheetNames,['Presenze giornaliere','Riepilogo mensile','Richieste','Legenda']);
  assert.equal(saved.Sheets['Presenze giornaliere'].A2.t,'s');
  assert.equal(saved.Sheets['Presenze giornaliere'].A2.v,'=Nome test');
  assert.equal(saved.Sheets['Presenze giornaliere'].A2.f,undefined);
  assert.equal(XLSX.utils.sheet_to_json(saved.Sheets['Presenze giornaliere']).length,30);
});

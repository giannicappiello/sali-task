import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {createMonthlyAttendanceWorkbook,createManagedOvertimeWorkbook,attendanceWorkbookBytes} from '../src/modules/hr/hrAttendanceExport.js';
const data={employees:[{user_id:'a',name:'Anna',active:true},{user_id:'b',name:'Bruno',active:true}],contracts:[{user_id:'a',effective_from:'2026-01-01',overtime_separate:true,overtime_rate:10,overtime_percent:25}],requests:[{user_id:'a',kind:'overtime',status:'approved',starts_at:'2026-09-10T08:00:00Z',ends_at:'2026-09-10T14:00:00Z'},{user_id:'a',kind:'overtime',status:'approved',starts_at:'2026-09-11T08:00:00Z',ends_at:'2026-09-11T14:00:00Z'}],attendance:[],shifts:[],closures:[]};
test('attendance download has only the monthly sheet with full Italian date headers',async()=>{
 const book=await createMonthlyAttendanceWorkbook(data,'2026-09');
 const saved=XLSX.read(await attendanceWorkbookBytes(book),{type:'array'});
 assert.deepEqual(saved.SheetNames,['Presenze mensili']);assert.equal(saved.Sheets['Presenze mensili'].H5.v,'01-09-2026');
});
test('managed export selects flagged employees, keeps daily hours and values them numerically',async()=>{
 const book=await createManagedOvertimeWorkbook(data,'2026-09');
 const saved=XLSX.read(await attendanceWorkbookBytes(book),{type:'array'});
 assert.deepEqual(saved.SheetNames,['Straordinario gestito']);
 const rows=XLSX.utils.sheet_to_json(saved.Sheets['Straordinario gestito']);assert.equal(rows.length,1);
 assert.equal(rows[0]['Ore totali'],12);assert.equal(rows[0]['Valorizzazione EUR'],150);assert.equal(rows[0]['10-09-2026'],6);assert.equal(rows[0].Dal,'01-09-2026');assert.equal(rows[0].Al,'30-09-2026');
});
test('missing rates and incomplete weekend punches do not create misleading amounts',async()=>{
 const missing={...data,contracts:[{...data.contracts[0],overtime_rate:null}]};
 const book=await createManagedOvertimeWorkbook(missing,'2026-09');
 assert.equal(XLSX.utils.sheet_to_json(book.Sheets['Straordinario gestito'])[0]['Valorizzazione EUR'],'Da definire');
 const incomplete={...data,attendance:[{user_id:'a',checkin_at:'2026-09-12T08:00:00Z',checkout_at:null}]};
 const check=await createManagedOvertimeWorkbook(incomplete,'2026-09',new Date('2026-09-13T09:00:00Z'));
 assert.equal(XLSX.utils.sheet_to_json(check.Sheets['Straordinario gestito'])[0]['Ore totali'],'Da verificare');
});

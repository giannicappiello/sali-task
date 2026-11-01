
import test from 'node:test';import assert from 'node:assert/strict';
import{defaultPresenceDay,defaultPresenceRows,applyDefaultPresence,dailyPresenceReport,absenceLabelForDay}from './hrDefaultPresence.js';
import{attendanceExportRows}from './hrAttendanceExport.js';
const policy={mode:'default_present',effective_from:'2026-11-01'};
const shift={user_id:'a',work_date:'2026-11-02',starts_at:'2026-11-02T07:00:00Z',ends_at:'2026-11-02T16:00:00Z',break_minutes:60};
const base=()=>({attendance_policy:policy,employees:[{user_id:'a',name:'A',active:true},{user_id:'inactive',active:false}],shifts:[shift],attendance:[],requests:[],closures:[],contracts:[],presence_schedules:[{user_id:'a',effective_from:'2026-11-01',weekdays:[1,2,3,4,5]}]});
const absent=(from,to,kind='permission',status='approved')=>({id:from+kind,user_id:'a',kind,status,starts_at:from,ends_at:to});
test('employee schedule supplies eight net hours without any clocking',()=>{
 const d=base(),r=defaultPresenceDay(d,'a','2026-11-02');assert.equal(r.presence_minutes,480);assert.equal(r.expected_minutes,480);
 const rows=defaultPresenceRows(d,['2026-11-02']);assert.equal(rows.length,1);assert.equal(rows[0].default_present,true);assert.ok(rows[0].checkout_at);
 assert.deepEqual(dailyPresenceReport(d,'a','2026-11-02'),{worked:480,expected:480,absence:0});
});
test('partial overlapping permissions are deducted once, full leave/illness cover the day',()=>{
 const d=base();d.requests=[absent('2026-11-02T07:00Z','2026-11-02T09:00Z'),absent('2026-11-02T08:00Z','2026-11-02T10:00Z')];
 assert.equal(defaultPresenceDay(d,'a','2026-11-02').presence_minutes,300);
 assert.deepEqual(dailyPresenceReport(d,'a','2026-11-02'),{worked:300,expected:300,absence:180});
 for(const kind of ['leave','illness','pregnancy']){d.requests=[absent('2026-11-02T00:00Z','2026-11-03T00:00Z',kind)];assert.equal(defaultPresenceRows(d,['2026-11-02']).length,0);}
});
test('pending, rejected, cancelled absences and approved overtime do not remove ordinary presence',()=>{
 const d=base();d.requests=['pending','rejected','cancelled'].map(status=>absent(shift.starts_at,shift.ends_at,'leave',status));d.requests.push(absent(shift.starts_at,shift.ends_at,'overtime'));
 assert.equal(defaultPresenceDay(d,'a','2026-11-02').presence_minutes,480);
});
test('rest days, closure, inactive staff and missing agreements never create invented work hours',()=>{
 const d=base();assert.equal(defaultPresenceDay(d,'a','2026-11-07').scheduled,true);assert.equal(defaultPresenceRows(d,['2026-11-07']).length,0);
 assert.equal(absenceLabelForDay(d,'a','2026-11-07'),'Giorno non lavorativo');
 d.closures=[{date_from:'2026-11-02',date_to:'2026-11-02'}];assert.equal(defaultPresenceRows(d,['2026-11-02']).length,0);
 d.closures=[];assert.equal(defaultPresenceDay(d,'inactive','2026-11-02'),null);
 d.shifts=[];assert.equal(defaultPresenceDay(d,'a','2026-11-02').scheduled,false);
});
test('history is preserved and repeated normalization never duplicates derived attendance',()=>{
 const d=base();d.attendance=[{id:'old',user_id:'a',checkin_at:'2026-10-30T07:00Z'},{id:'stale',user_id:'a',checkin_at:'2026-11-02T07:00Z'}];
 const once=applyDefaultPresence(d,'2026-11'),twice=applyDefaultPresence(once,'2026-11');assert.deepEqual(once,twice);assert.ok(once.attendance.some(r=>r.id==='old'));assert.ok(!once.attendance.some(r=>r.id==='stale'));assert.equal(d.attendance.length,2);
 assert.equal(defaultPresenceDay(d,'a','2026-10-30'),null);
});
test('export has scheduled presence, no false missing-checkout/absence alarms, no future actuals',()=>{
 const d=base();d.requests=[absent('2026-11-02T07:00Z','2026-11-02T09:00Z')];
 const rows=attendanceExportRows(d,'2026-11',new Date('2026-11-03T18:00Z'));const row=rows.find(r=>r.Data==='2026-11-02');
 assert.equal(row['Ore presenza rilevata'],6);assert.equal(row['Ore scoperte da verificare'],0);assert.doesNotMatch(row.Note,/da verificare|senza uscita/);assert.match(row['Entrate / uscite'],/secondo orario/);
 assert.equal(rows.find(r=>r.Data==='2026-11-07')['Ore presenza rilevata'],null); // future rest day excluded from actuals
 assert.equal(rows.find(r=>r.Data==='2026-11-02').employeeId,'a');
});

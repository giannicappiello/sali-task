import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.tmp/hr-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { companyCalendarRequest } from './company-calendar.js';
import { companyCalendarDay } from '../src/modules/hr/companyCalendarDay.js';
import { italianHoliday } from '../src/modules/hr/hrCalendar.js';

test('MES calendar API authenticates before accessing calendar and validates payload',async()=>{
  let calls=0;const db={rpc:async()=>{calls++;return {data:{schemaVersion:1}};}};
  for(const secret of ['', 'incorrect']) await assert.rejects(companyCalendarRequest({method:'GET',headers:{'x-workspace-secret':secret}},db,'expected'),{status:401});
  assert.equal(calls,0);
  await assert.rejects(companyCalendarRequest({method:'POST',headers:{'x-workspace-secret':'expected'},body:{}},db,'expected'),{status:400});
  assert.deepEqual(await companyCalendarRequest({method:'GET',headers:{'x-workspace-secret':'expected'}},db,'expected'),{schemaVersion:1});
});
test('company calendar: permissions, version history, exceptions, legacy import idempotency',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table utenti(id uuid primary key);insert into utenti values('00000000-0000-0000-0000-000000000001');
      create function workspace_hr_actor() returns uuid language sql as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;
      create function workspace_user_is_admin() returns boolean language sql as $$select current_setting('test.admin',true)='yes'$$;
      create table workspace_hr_closures(id uuid default gen_random_uuid(),name text,date_from date not null,date_to date not null,check(date_to>=date_from));
      create table workspace_hr_audit(actor_id uuid,action text,target_id uuid,details jsonb);
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20260917160000_workspace_company_calendar.sql',import.meta.url),'utf8'));
    const query=(sql,args=[])=>db.query(sql,args);
    const baseline=(await query('select workspace_company_calendar_data() value')).rows[0].value;
    assert.deepEqual(baseline.versions[0].week['1'],[['07:30','16:30']]);
    const day=(await query("select ((now() at time zone 'Europe/Rome')::date+1)::text as value" )).rows[0].value;
    const week={...baseline.versions[0].week,'1':[['06:00','12:00'],['13:00','18:00']]};
    await db.exec("set role authenticated;set test.admin='no';");
    await assert.rejects(query('select workspace_company_calendar_save($1,$2)',['version',JSON.stringify({effectiveFrom:day,week})]),/riservato/);
    await assert.rejects(query('select * from workspace_company_calendar_versions'),/permission denied/);
    await assert.rejects(query('select workspace_company_calendar_import($1)',['[]']),/permission denied/);
    await db.exec("set test.admin='yes';");
    await query('select workspace_company_calendar_save($1,$2)',['version',JSON.stringify({effectiveFrom:day,week})]);
    await assert.rejects(query('select workspace_company_calendar_save($1,$2)',['version',JSON.stringify({effectiveFrom:day,week})]),/duplicate key/);
    await assert.rejects(query('select workspace_company_calendar_save($1,$2)',['version',JSON.stringify({effectiveFrom:'2000-01-01',week})]),/passati/);
    await assert.rejects(query('select workspace_company_calendar_save($1,$2)',['exception',JSON.stringify({day,intervals:[['10:00','12:00'],['11:00','13:00']],reason:'invalid'})]),/sovrapposizioni/);
    await query('select workspace_company_calendar_save($1,$2)',['exception',JSON.stringify({day,intervals:[],reason:'Chiusura straordinaria'})]);
    await db.exec('reset role;set role service_role;');
    const imported=JSON.stringify([{key:'mes:one',from:day,to:day,reason:'Chiusura MES'}]);
    await query('select workspace_company_calendar_import($1)',[imported]);
    const result=(await query('select workspace_company_calendar_import($1) value',[imported])).rows[0].value;
    assert.equal(result.closures.filter(c=>c.reason==='Chiusura MES').length,1);assert.equal(result.versions.length,2);assert.equal(result.exceptions.length,1);
    assert.ok(result.lastMesSync);
    assert.ok(result.closures.some(c=>c.from.endsWith('-12-25')));
    await db.exec('reset role');
    const holidays=(await query('select day::text,reason from workspace_calendar_holidays(2027)')).rows;
    assert.ok(holidays.some(h=>h.day==='2027-03-29'&&h.reason==='Lunedì dell’Angelo'));
    for(const h of holidays) assert.ok(italianHoliday(h.day),h.day);
    const view={...result,exceptions:[{day:'2027-12-25',intervals:[['08:00','12:00']],reason:'Apertura'}]};
    assert.equal(companyCalendarDay(view,'2027-12-25').intervals.length,1);
    assert.equal(companyCalendarDay(result,'2027-12-25').intervals.length,0);
    assert.deepEqual(companyCalendarDay(baseline,'2026-09-18').intervals,[['07:30','16:30']]);
  }finally{await db.close();}
});

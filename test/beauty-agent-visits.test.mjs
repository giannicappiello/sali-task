import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCustomerVisitScope, applyOrganizationScope } from '../supabase/functions/report-giornate-api/organizationScope.js';
process.env.CLUB_STAFF_FIXTURE_ONLY = '1';
const { createStaffFixture } = await import('./club-staff-scope.test.mjs');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('agents read beauty appointments and details for their customers, without write access or foreign visits', async () => {
  const db = await createStaffFixture();
  const rows = async sql => (await db.query(sql)).rows;
  const actor = async n => db.exec(`reset role;set test.auth='${id(n)}';set role authenticated;`);
  try {
    await db.exec(`
      alter table integrazioni_utenti add column external_role text;
      update integrazioni_utenti set external_role='beauty';
      insert into integrazioni_utenti(utente_id,modulo,enabled,mexal_agente_id,external_role) values
       ('${id(10)}','report_giornate',true,'${id(101)}','agent'),('${id(20)}','report_giornate',true,'${id(102)}','agent');
      alter table crm_accounts add column codice_cliente_mexal text;
      update crm_accounts set tipo='b2b',codice_cliente_mexal=case when id='${id(201)}' then 'A' else 'B' end;
      create table beauty_clienti_mexal(codice_cliente text,legacy_farmacia_id uuid);
      insert into beauty_clienti_mexal values('A','${id(801)}'),('B','${id(802)}');
      create table crm_activities(id uuid primary key,account_id uuid,crm_tipo text,tipo text);
      insert into crm_activities values('${id(701)}','${id(201)}','b2b','visita_beauty'),
        ('${id(702)}','${id(202)}','b2b','visita_beauty'),('${id(703)}','${id(201)}','b2b','telefonata');
      create table crm_visit_details(activity_id uuid primary key);
      insert into crm_visit_details values('${id(701)}'),('${id(702)}');
      create table workspace_access_revision(id boolean,revision int);
      alter table crm_accounts enable row level security;
      alter table crm_activities enable row level security;
      alter table crm_visit_details enable row level security;
      grant select,insert,update,delete on crm_accounts,crm_activities,crm_visit_details to authenticated;
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261027170000_beauty_agent_customer_visits.sql',import.meta.url),'utf8'));
    for (const [n, visit, account, pharmacy] of [[10,701,201,801],[20,702,202,802]]) {
      await actor(n);
      assert.deepEqual((await rows('select id from crm_activities')).map(r=>r.id),[id(visit)]);
      assert.deepEqual((await rows('select id from crm_accounts')).map(r=>r.id),[id(account)]);
      assert.deepEqual((await rows('select activity_id from crm_visit_details')).map(r=>r.activity_id),[id(visit)]);
      assert.deepEqual((await rows('select farmacia_id from beauty_visible_legacy_pharmacy_ids()')).map(r=>r.farmacia_id),[id(pharmacy)]);
      assert.equal((await db.query("update crm_activities set tipo='annullata'")).affectedRows,0);
      await assert.rejects(db.exec(`insert into crm_activities values('${id(704)}','${id(account)}','b2b','visita_beauty')`),/row-level security/);
    }
    await actor(30); assert.deepEqual(await rows('select id from crm_activities'),[]);
    await db.exec(`reset role;update integrazioni_utenti set enabled=false where utente_id='${id(10)}'`);
    await actor(10); assert.deepEqual(await rows('select id from crm_activities'),[]);
  } finally { await db.close(); }
});

const queryFor = source => ({
  rows: source, select() { return this; }, order() { return this; },
  in(column, values) { this.rows=this.rows.filter(row=>values.includes(row[column])); return this; },
  async range(from,to) { return {data:this.rows.slice(from,to+1),error:null}; },
});
test('legacy scope follows customer pharmacies, paginates, and never shares a consultant entire portfolio or write rights', async () => {
  const pharmacies = Array.from({length:501},(_,i)=>({farmacia_id:`p${i}`}));
  const scoped = {
    rpc() { return queryFor(pharmacies); },
    from() { return queryFor([{activity_id:'crm',planning:{consultant_id:'crm-beauty'}}]); },
  };
  const report = { from() { return queryFor([
    {id:'d1',farmacia_id:'p0',consultant_id:'shared-beauty'},
    {id:'d2',farmacia_id:'p500',consultant_id:'last-page-beauty'},
    {id:'foreign',farmacia_id:'other',consultant_id:'foreign-beauty'},
  ]); } };
  const own = { visibleBeautyIds:['own-beauty'],writableBeautyIds:['own-beauty'] };
  const scope = await loadCustomerVisitScope(scoped,report,{external_role:'agent'},own);
  assert.equal(scope.visibleCustomerPharmacyIds.length,501);
  assert.deepEqual(scope.visibleBeautyIds,['own-beauty','shared-beauty','last-page-beauty','crm-beauty']);
  const filters = { in(column,values) { return {column,values}; }, eq(column,value) { return {column,value}; } };
  assert.deepEqual(applyOrganizationScope(filters,'giornate_promozionali',scope),{column:'farmacia_id',values:pharmacies.map(p=>p.farmacia_id)});
  assert.deepEqual(applyOrganizationScope(filters,'giornate_promozionali',scope,true),{column:'consultant_id',values:['own-beauty']});
  assert.deepEqual(applyOrganizationScope(filters,'aperture_contatti',scope),{column:'beauty_id',values:['own-beauty']});
  assert.deepEqual(applyOrganizationScope(filters,'giornate_promozionali',{...scope,visibleCustomerPharmacyIds:[]}),{column:'id',value:'00000000-0000-0000-0000-000000000000'});
  assert.equal(await loadCustomerVisitScope(null,null,{external_role:'beauty'},own),own);
});

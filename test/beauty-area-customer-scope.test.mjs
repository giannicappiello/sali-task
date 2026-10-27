import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
process.env.CLUB_STAFF_FIXTURE_ONLY = '1';
const { createStaffFixture } = await import('./club-staff-scope.test.mjs');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('beauty inherits linked manager customers without operational permissions or foreign areas', async () => {
  const db = await createStaffFixture();
  const query = async sql => (await db.query(sql)).rows;
  const actor = async n => db.exec(`reset role;set test.auth='${id(n)}';set role authenticated;`);
  const scope = async () => (await query('select workspace_data_scope() s'))[0].s;
  const customers = async () => (await query('select crm_visible_canonical_customer_codes() c order by c')).map(r => r.c);
  try {
    await db.exec(`
      alter table ruoli add column accesso_come_beauty boolean default false;
      update ruoli set accesso_come_beauty=true where id='${id(22)}';
      create table workspace_commercial_read_rules(role_id uuid,department_id uuid);
      create table workspace_access_revision(id boolean,revision int);
      insert into workspace_access_revision values(true,1);
      insert into mexal_agenti(id,codice,workspace_utente_id) values('${id(103)}','AREA','${id(40)}');
      insert into mexal_agenti(id,codice,responsabile_utente_id) values('${id(104)}','AREA-EXTRA','${id(40)}');
      insert into ordini_clienti_cache(codice_cliente,ragione_sociale,codice_agente_mexal)
        values('C','Area extra','AREA-EXTRA'),('X','Excluded','AREA-EXTRA');
      update ordini_clienti_cache set sync_excluded=true where codice_cliente='X';
      update integrazioni_utenti set mexal_agente_id='${id(103)}' where utente_id='${id(30)}';
    `);
    await actor(30); const before = await scope();
    await db.exec('reset role');
    const migration = await readFile(new URL('../supabase/migrations/20261027160000_beauty_area_customer_scope.sql',import.meta.url),'utf8');
    await db.exec(migration);
    await actor(30); const after = await scope();
    assert.deepEqual(await customers(), ['A','C']);
    for (const key of ['mode','user_ids','department_ids','team_scope','commercial_mode']) assert.deepEqual(after[key],before[key]);
    await assert.rejects(query(`select workspace_data_scope_for_profile('${id(20)}')`), /permission denied/);
    await actor(40); assert.deepEqual(await customers(),['A','C']);
    await actor(20); assert.deepEqual(await customers(),['B']);
    await db.exec(`reset role;update integrazioni_utenti set enabled=false where utente_id='${id(30)}'`);
    await actor(30); assert.deepEqual(await customers(),[]);
    await db.exec(`reset role;update utenti set responsabile_utente_id='${id(40)}' where id='${id(30)}'`);
    await actor(30); assert.deepEqual(await customers(),['A','C']);
    await db.exec(`reset role;update utenti set attivo=false where id='${id(40)}'`);
    await actor(30); assert.deepEqual(await customers(),[]);
    await db.exec(`reset role;update utenti set attivo=true where id='${id(40)}';insert into workspace_customer_user_links values('${id(30)}','B')`);
    await actor(30); assert.deepEqual(await customers(),['B']); assert.deepEqual((await scope()).agent_ids,[]);
    await db.exec(`reset role;delete from workspace_customer_user_links;update utenti set responsabile_utente_id=null where id='${id(30)}';update integrazioni_utenti set enabled=true,mexal_agente_id='${id(101)}' where utente_id='${id(30)}'`);
    await actor(30); assert.deepEqual(await customers(),['A']);
  } finally { await db.close(); }
});

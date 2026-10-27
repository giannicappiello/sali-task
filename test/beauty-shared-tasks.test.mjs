import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
process.env.CLUB_STAFF_FIXTURE_ONLY='1';
const {createStaffFixture}=await import('./club-staff-scope.test.mjs');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('one historical Beauty task follows the source state and is shared with beauty, customer agent and manager only',async()=>{
 const db=await createStaffFixture();
 const q=async sql=>(await db.query(sql)).rows;
 const actor=async n=>db.exec(`reset role;set test.auth='${id(n)}';set role authenticated;`);
 try{
  await db.exec(`
   alter table ruoli add column accesso_come_beauty boolean default false;
   update ruoli set accesso_come_beauty=true where id='${id(22)}';
   update utenti set responsabile_utente_id='${id(40)}' where id='${id(30)}';
   alter table integrazioni_utenti add column external_beauty_id uuid,add column external_agent_id uuid;
   update integrazioni_utenti set external_beauty_id='${id(901)}' where utente_id='${id(30)}';
   insert into integrazioni_utenti(utente_id,modulo,enabled,mexal_agente_id,external_agent_id)
     values('${id(10)}','report_giornate',true,'${id(101)}','${id(601)}');
   alter table crm_accounts add column codice_cliente_mexal text;
   create table beauty_clienti_mexal(codice_cliente text,legacy_farmacia_id uuid);
   insert into beauty_clienti_mexal values('A','${id(801)}');
   create table crm_activities(id uuid primary key,workspace_task_id uuid,tipo text,account_id uuid,creato_da uuid,source_id uuid,customer_key text);
   create table crm_visit_details(activity_id uuid,legacy_giornata_id uuid,report_data jsonb default '{}');
   create table v4_fasi_progetto(id uuid primary key default gen_random_uuid(),progetto_id uuid,titolo text,descrizione text,stato text,priorita text,assegnato_a uuid,
     ordine int,deadline date,completato_at timestamptz,completato_da uuid,creato_da uuid,modificato_da uuid,source_type text,source_id uuid,crm_customer_key text,crm_tipo text,
     crm_activity_id uuid,updated_at timestamptz);
   create table beauty_day_tasks(giornata_id uuid primary key,task_id uuid unique,consultant_id uuid,legacy_agent_id uuid,customer_code text,source_date date,source_status text);
  `);
  const sql=await readFile(new URL('../supabase/migrations/20261027180000_beauty_workspace_task_sharing.sql',import.meta.url),'utf8');
  for(const name of ['workspace_sync_beauty_day','workspace_attach_beauty_day_task','workspace_visible_beauty_task_ids']){
   const start=sql.indexOf('create or replace function public.'+name+'(');
   const end=sql.indexOf('$$;',sql.indexOf('as $$',start))+3;
   await db.exec(sql.slice(start,end));
  }
  const day={id:id(1001),farmacia_id:id(801),consultant_id:id(901),data:'2026-11-10',stato:'pianificata',customer_name:'Farmacia test',legacy_agent_id:id(601)};
  const sync=async value=>{
   await db.exec('reset role;set role service_role');
   return (await db.query('select workspace_sync_beauty_day($1,$2) task',[value,id(1)])).rows[0].task;
  };
  const task=await sync(day);assert.equal(await sync(day),task);
  for(const n of [10,30,40]){await actor(n);assert.ok((await q('select workspace_visible_beauty_task_ids() id')).some(r=>r.id===task));}
  await actor(20);assert.deepEqual(await q('select workspace_visible_beauty_task_ids() id'),[]);
  await sync({...day,stato:'eseguita'});await db.exec('reset role');
  let saved=(await q('select * from v4_fasi_progetto'))[0];assert.equal(saved.stato,'evaso');assert.ok(saved.completato_at);
  await sync({...day,data:'2026-01-01'});await db.exec('reset role');
  saved=(await q('select * from v4_fasi_progetto'))[0];assert.equal(saved.stato,'da_evadere');assert.equal(saved.completato_at,null);assert.equal(new Date(saved.deadline).toISOString().slice(0,10),'2026-01-01');
  assert.equal((await q('select count(*)::int n from v4_fasi_progetto'))[0].n,1);
  const other=await sync({...day,id:id(1002),consultant_id:id(902)});
  await actor(30);assert.ok(!(await q('select workspace_visible_beauty_task_ids() id')).some(r=>r.id===other));
  await actor(10);assert.ok((await q('select workspace_visible_beauty_task_ids() id')).some(r=>r.id===other));
  await assert.rejects(db.query('select workspace_sync_beauty_day($1,$2)',[day,id(10)]),/riservata al servizio/);
  await db.exec(`reset role;update mexal_agenti set responsabile_utente_id=null,workspace_utente_id=null where id='${id(101)}';update integrazioni_utenti set enabled=false where utente_id='${id(10)}';update utenti set responsabile_utente_id=null where id='${id(10)}'`);
  await actor(10);assert.deepEqual(await q('select workspace_visible_beauty_task_ids() id'),[]);
 }finally{await db.close();}
});

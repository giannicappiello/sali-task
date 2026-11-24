import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '../.tmp/hr-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';

const id = () => randomUUID();
test('Monthly calendar event persistence and HR authorization', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const admin = id(), employee = id(), manager = id(), outsider = id(), dept = id(), adminRole = id(), normalRole = id();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    create table ruoli(id uuid primary key,amministratore_workspace boolean);
    create table reparti(id uuid primary key default gen_random_uuid(),nome text,descrizione text,attivo boolean default true);
    create table utenti(id uuid primary key,auth_user_id uuid,attivo boolean default true,nome text,cognome text,ruolo_id uuid,reparto_id uuid);
    create table utenti_reparti(utente_id uuid,reparto_id uuid,primary key(utente_id,reparto_id));
    create table workspace_eccezioni_utente(utente_id uuid,ambito text,codice text,decisione text,livello_accesso text,motivazione text,valida_fino_a timestamptz,creata_da uuid,aggiornata_il timestamptz,unique(utente_id,ambito,codice));
    create function workspace_user_is_admin() returns boolean language sql stable security definer as $$ select coalesce((select r.amministratore_workspace from utenti u join ruoli r on r.id=u.ruolo_id where u.auth_user_id=auth.uid() and u.attivo),false) $$;
    create function workspace_current_profile_id() returns uuid language sql stable security definer as $$ select id from utenti where auth_user_id=auth.uid() $$;
    create function workspace_touch_access_revision() returns trigger language plpgsql as $$ begin return null; end $$;
    create table notifiche(id uuid primary key default gen_random_uuid(),utente_id uuid,titolo text,messaggio text,tipo text,evento text,url text,metadata jsonb);
    create table workspace_access_revision(id boolean primary key, revision bigint default 0);
    insert into workspace_access_revision values(true,0);
    create function workspace_screen_level_for_user(target_user_id uuid,target_screen text) returns text language sql stable security definer as $$
      with t as (select target_user_id id),s as(select '{}'::jsonb metadati)
      select case when s.metadati->>'admin_only'='true' then 'nessuno' else 'lettura' end from t,s $$;
    create table workspace_moduli(codice text primary key,nome text,descrizione text,tipo text,area text,percorso text,provider text,sempre_disponibile boolean,assegnabile_reparto boolean,configurabile_ruolo boolean,mostra_menu boolean,attivo boolean,ordine integer,icona text,livello_self_service text);
    create table workspace_schermate(codice text primary key,nome text,descrizione text,provider text,percorso text,chiave_componente text,ordine integer,icona text,metadati jsonb);
    create table workspace_moduli_schermate(modulo_codice text,schermata_codice text,ordine integer,predefinita boolean,visibile_menu boolean);
    create table workspace_menu_voci(codice text,nome text,descrizione text,icona text,ordine integer,attiva boolean);
    create table workspace_menu_moduli(voce_codice text,modulo_codice text,ordine integer);
    create function workspace_module_enabled_for_user(target_user_id uuid,target_module text) returns boolean language sql stable security definer as $$
      with target as (select u.id,r.amministratore_workspace is_admin from utenti u join ruoli r on r.id=u.ruolo_id where u.id=target_user_id and u.attivo)
      select coalesce((select case when t.is_admin then true else false end from target t join workspace_moduli m on m.codice=target_module),false) $$;
    insert into ruoli values('${adminRole}',true),('${normalRole}',false);
    insert into utenti(id,auth_user_id,nome,ruolo_id) values('${admin}','${admin}','Admin','${adminRole}'),('${employee}','${employee}','Dipendente','${normalRole}'),('${manager}','${manager}','Gestore','${normalRole}'),('${outsider}','${outsider}','Esterno','${normalRole}');
    insert into reparti(id,nome) values('${dept}','Produzione');
  `);
  const accessMigration = await readFile(new URL('../supabase/migrations/20260912150000_workspace_access_consistency.sql', import.meta.url), 'utf8');
  await db.exec(accessMigration.slice(accessMigration.indexOf('create or replace function public.workspace_save_user_access('), accessMigration.indexOf('-- One canonical department')));
  const migration = await readFile(new URL('../supabase/migrations/20260916180000_workspace_hr.sql', import.meta.url), 'utf8');
  try { await db.exec(migration); await db.exec(await readFile(new URL('../supabase/migrations/20260916190000_workspace_hr_site_address.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../supabase/migrations/20260916200000_workspace_hr_flexible_agreements.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../supabase/migrations/20260916210000_workspace_hr_home_punch.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../supabase/migrations/20260916220000_workspace_hr_catalog_alias.sql', import.meta.url), 'utf8')); await db.exec(await readFile(new URL('../supabase/migrations/20260916230000_workspace_hr_request_recipients.sql', import.meta.url), 'utf8')); } catch (error) { console.error('Migration:', error.message, error.where); throw error; }
  await db.exec(await readFile(new URL('../supabase/migrations/20260917120000_workspace_hr_employee_editor.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20260917160000_workspace_company_calendar.sql', import.meta.url), 'utf8'));
  for (const migration of ['20260924180000_workspace_hr_admin_absences','20260924190000_verify_workspace_hr_admin_absence_rpc','20260924200000_workspace_hr_admin_absence_validation']) await db.exec(await readFile(new URL('../supabase/migrations/'+migration+'.sql', import.meta.url),'utf8'));
  async function as(user, sql, args = []) {
    await db.exec('begin; set local role authenticated;');
    try { await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]); const result = await db.query(sql, args); await db.exec('commit'); return result.rows; }
    catch (error) { await db.exec('rollback'); throw error; }
  }
  const rpc = async (user, fn, args) => (await as(user, `select ${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args))[0].value;

  await db.exec(await readFile(new URL('../supabase/migrations/20261124095200_hr_monthly_calendar_requests.sql',import.meta.url),'utf8'));
  const hr=(await db.query('select id from reparti where workspace_hr')).rows[0].id;
  for(const user of [employee,manager]) await rpc(admin,'workspace_save_user_access',[user,normalRole,[hr],'[]',true]);
  await rpc(admin,'workspace_hr_configure',['member',JSON.stringify({user_id:manager,manager:true})]);
  const site=(await rpc(admin,'workspace_hr_configure',['site',JSON.stringify({name:'Sede test',latitude:40,longitude:14})])).id;
  for(const user of [employee,manager]) await rpc(admin,'workspace_hr_configure',['contract',JSON.stringify({user_id:user,effective_from:'2020-01-01',site_id:site,weekly_hours:40,start_time:'08:00',end_time:'17:00',weekdays:[1,2,3,4,5],break_minutes:60,agreed_pay:1000,pay_period:'month',overtime_mode:'paid',overtime_rate:10,overtime_percent:25})]);
  const save=(user,payload)=>rpc(user,'workspace_hr_save_calendar_request',[JSON.stringify(payload)]);
  const draft=(kind='permission',from='2030-11-04T08:00:00Z',to='2030-11-04T09:00:00Z')=>({user_id:employee,id:null,expected:null,kind,starts_at:from,ends_at:to,note:'Evento di prova',request_key:id()});
  const version=async key=>(await db.query("select jsonb_build_object('kind',kind,'starts_at',starts_at,'ends_at',ends_at,'note',note,'status',status) as v from workspace_hr_requests where id=$1",[key])).rows[0].v;
  let inserted, original;
  await t.test('manager assigns an approved partial absence; retries never duplicate; key cannot change payload',async()=>{
    original=draft(); inserted=await save(manager,original);
    assert.equal(inserted.status,'approved');
    assert.deepEqual(await save(manager,original),inserted);
    assert.equal((await db.query('select count(*)::int n from workspace_hr_requests')).rows[0].n,1);
    await assert.rejects(save(manager,{...original,note:'Dati differenti'}),/dati diversi/);
  });
  await t.test('approved overtime for another employee coexists with partial permission on the same day',async()=>{
    const result=await save(admin,draft('overtime','2030-11-04T17:00:00Z','2030-11-04T19:30:00Z'));
    assert.equal(result.status,'approved');
    assert.equal((await db.query('select count(*)::int n from workspace_hr_requests')).rows[0].n,2);
  });
  await t.test('editing retains identity and prior history, enforces optimistic concurrency and overlap',async()=>{
    const expected=await version(inserted.id);
    const changed={...draft(),id:inserted.id,expected,starts_at:'2030-11-04T09:00:00Z',ends_at:'2030-11-04T10:00:00Z'};
    assert.equal((await save(admin,changed)).id,inserted.id);
    assert.deepEqual(await save(admin,changed),{id:inserted.id,status:'approved'});
    await assert.rejects(save(manager,{...changed,request_key:id(),ends_at:'2030-11-04T11:00:00Z'}),/altro utente/);
    await assert.rejects(save(manager,draft('leave','2030-11-04T09:30:00Z','2030-11-04T11:00:00Z')),/sovrapposto/);
    const audit=(await db.query("select details from workspace_hr_audit where action='calendar_request.save' and target_id=$1 order by id desc limit 1",[inserted.id])).rows[0].details;
    assert.equal(audit.before.ends_at,expected.ends_at); assert.equal(Date.parse(audit.after.ends_at),Date.parse('2030-11-04T10:00:00Z'));
  });
  await t.test('own overtime stays pending and approved own overtime cannot be enlarged',async()=>{
    const own={...draft('overtime','2030-11-05T17:00:00Z','2030-11-05T18:00:00Z'),user_id:manager};
    const result=await save(manager,own); assert.equal(result.status,'pending');
    const update={...own,id:result.id,expected:await version(result.id),request_key:id(),ends_at:'2030-11-05T19:00:00Z'};
    assert.equal((await save(manager,update)).status,'pending');
    await db.query("update workspace_hr_requests set status='approved',reviewed_by=$2 where id=$1",[result.id,admin]);
    await assert.rejects(save(manager,{...update,expected:await version(result.id),request_key:id(),ends_at:'2030-11-05T20:00:00Z'}),/altro responsabile/);
  });
  await t.test('ordinary users, anonymous callers, invalid periods and disabled overtime are rejected',async()=>{
    await assert.rejects(save(employee,draft()),/non autorizzata/);
    await assert.rejects(save(outsider,draft()));
    await assert.rejects(save(admin,{...draft(),note:''}),/motivazione/);
    await assert.rejects(save(admin,{...draft(),kind:'correction'}),/Causale/);
    await assert.rejects(save(admin,draft('overtime','2030-11-06T00:00:00Z','2030-11-06T17:00:00Z')),/16 ore/);
    await db.query("update workspace_hr_contracts set overtime_mode='disabled' where user_id=$1",[employee]);
    await assert.rejects(save(admin,draft('overtime','2030-11-06T17:00:00Z','2030-11-06T18:00:00Z')),/non abilitato/);
    assert.equal((await db.query('select count(*)::int n from workspace_hr_attendance')).rows[0].n,0);
    assert.equal((await db.query("select has_function_privilege('anon','public.workspace_hr_save_calendar_request(jsonb)','execute') allowed")).rows[0].allowed,false);
  });
});

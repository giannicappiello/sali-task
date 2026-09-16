import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '../.tmp/hr-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';

const id = () => randomUUID();
test('HR migration and authorization flows in isolated PostgreSQL', async (t) => {
  const db = new PGlite();
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
  async function as(user, sql, args = []) {
    await db.exec('begin; set local role authenticated;');
    try { await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]); const result = await db.query(sql, args); await db.exec('commit'); return result.rows; }
    catch (error) { await db.exec('rollback'); throw error; }
  }
  const rpc = async (user, fn, args) => (await as(user, `select ${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args))[0].value;
  const cfg = (action, payload) => rpc(admin, 'workspace_hr_configure', [action, JSON.stringify(payload)]);
  const hr = (await db.query('select id from reparti where workspace_hr')).rows[0].id;
  await t.test('department assignment is independent of operational memberships', async () => {
    await rpc(admin, 'workspace_save_user_access', [employee, normalRole, [dept, hr], '[]', true]);
    await rpc(admin, 'workspace_save_user_access', [manager, normalRole, [hr], '[]', true]);
    const memberships = (await db.query('select * from utenti_reparti')).rows;
    assert.deepEqual(memberships, [{ utente_id: employee, reparto_id: dept }]);
    assert.equal((await rpc(employee, 'workspace_module_enabled_for_user', [employee, 'hr'])), true);
    assert.equal((await rpc(outsider, 'workspace_module_enabled_for_user', [outsider, 'hr'])), false);
    await cfg('member', { user_id: manager, manager: true });
  });
  const site = (await cfg('site', { name: 'Sede test', address: 'Via di prova 1, Roma', latitude: 40, longitude: 14, auto_checkout: true })).id;
  const today = (await db.query("select (now() at time zone 'Europe/Rome')::date::text as day")).rows[0].day;
  const terms = { user_id: employee, effective_from: today, site_id: site, weekly_hours: 40, start_time: '08:00', end_time: '17:00', weekdays: [1, 2, 3, 4, 5, 6, 7], break_minutes: 60, agreed_pay: 3210.45, pay_period: 'month', overtime_mode: 'paid', overtime_rate: 20, overtime_percent: 25 };
  await cfg('contract', terms);
  assert.equal((await rpc(admin, 'workspace_hr_snapshot', [today, true])).sites.find(s => s.id === site).address, 'Via di prova 1, Roma');
  const snap = (user, config = false) => rpc(user, 'workspace_hr_snapshot', [today, config]);
  await t.test('employees/managers cannot retrieve or mutate contracts, admin can', async () => {
    for (const user of [employee, manager]) {
      const s = await snap(user);
      assert.equal('contracts' in s, false);
      assert.equal(JSON.stringify(s).includes('3210.45'), false);
      await assert.rejects(snap(user, true), /admin/);
      await assert.rejects(rpc(user, 'workspace_hr_configure', ['contract', JSON.stringify(terms)]), /admin/);
      await assert.rejects(as(user, 'select * from workspace_hr_contracts'), /permission denied/);
    }
    assert.equal((await snap(admin, true)).contracts[0].agreed_pay, 3210.45);
    await assert.rejects(snap(outsider), /abilitato/);
    assert.equal((await snap(employee)).employees.length, 1);
    assert.equal((await snap(manager)).employees.length, 2);
    assert.ok((await snap(employee)).shifts.length > 0);
  });
  await t.test('past agreements accept empty and descriptive fields without inventing shifts or amounts', async () => {
    await cfg('contract', { user_id: manager, effective_from: '2020-01-01' });
    let saved = (await snap(admin, true)).contracts.find(c => c.user_id === manager && c.effective_from === '2020-01-01');
    assert.equal(saved.agreed_pay, null);
    assert.equal(saved.site_id, null);
    await cfg('contract', { user_id: manager, effective_from: '2020-02-01', site_id: 'Sede da definire', weekly_hours: 'part time 20h', start_time: 'flessibile', end_time: '', weekdays: 'a chiamata', break_minutes: 'da concordare', agreed_pay: 'CCNL livello B2', pay_period: 'da definire', overtime_mode: 'accordo individuale', overtime_rate: '', overtime_percent: 'forfait' });
    saved = (await snap(admin, true)).contracts.find(c => c.user_id === manager && c.effective_from === '2020-02-01');
    assert.equal(saved.agreement_fields.agreed_pay, 'CCNL livello B2');
    assert.equal(saved.agreed_pay, null);
    assert.equal(saved.overtime_percent, null);
    assert.equal((await snap(admin, true)).shifts.some(s => s.user_id === manager), false);
    assert.equal(JSON.stringify(await snap(manager)).includes('CCNL livello B2'), false);
    await cfg('contract', { ...terms, effective_from: '2019-01-01', agreed_pay: '1200,50', weekdays: '1, 2, 3, 4, 5', site_id: 'Sede test' });
    saved = (await snap(admin, true)).contracts.find(c => c.user_id === employee && c.effective_from === '2019-01-01');
    assert.equal(saved.agreed_pay, 1200.5);
    assert.equal(saved.site_id, site);
    assert.deepEqual(saved.weekdays, [1,2,3,4,5]);
    await assert.rejects(cfg('contract', { user_id: manager, effective_from: 'data non valida' }));
  });
  await t.test('home punch status exposes only own membership and presence', async () => {
    assert.equal((await rpc(admin,'workspace_hr_punch_status',[])).member,false);
    const status = await rpc(employee,'workspace_hr_punch_status',[]);
    assert.equal(status.member,true);
    assert.equal(status.actor_id,employee);
    assert.equal(status.open,null);
    assert.deepEqual(Object.keys(status).sort(),['actor_id','member','open']);
    await assert.rejects(rpc(outsider,'workspace_hr_punch_status',[]),/abilitato/);
  });
  await t.test('renamed HR catalog module preserves membership-only access under both codes', async () => {
    await db.exec("update workspace_moduli set codice='human_resources' where codice='hr'");
    for (const code of ['hr','human_resources']) {
      assert.equal(await rpc(employee,'workspace_module_enabled_for_user',[employee,code]),true);
      assert.equal(await rpc(outsider,'workspace_module_enabled_for_user',[outsider,code]),false);
    }
    assert.equal(await rpc(employee,'workspace_screen_level_for_user',[employee,'hr']),'scrittura');
    assert.equal(await rpc(outsider,'workspace_screen_level_for_user',[outsider,'hr']),'nessuno');
    await db.exec("update workspace_moduli set codice='hr' where codice='human_resources'");
  });
  const position = (latitude = 40, accuracy = 3, sampled_at = new Date().toISOString()) => JSON.stringify({ latitude, longitude: 14, accuracy, sampled_at });
  const punch = (user, action, key = id(), pos = null, session = null) => rpc(user, 'workspace_hr_punch', [action, key, pos, session]);
  let session;
  await t.test('server checks fresh precise location and prevents duplicate check-ins', async () => {
    await assert.rejects(punch(employee, 'in', id(), position(40.01)), /Avvicinati/);
    await assert.rejects(punch(employee, 'in', id(), position(40, 100)), /attendibile/);
    await assert.rejects(punch(employee, 'in', id(), position(40, 3, '2000-01-01T00:00:00Z')), /attendibile/);
    const key = id(); session = (await punch(employee, 'in', key, position())).id;
    assert.equal((await rpc(employee,'workspace_hr_punch_status',[])).open.id,session);
    assert.equal((await rpc(manager,'workspace_hr_punch_status',[])).open,null);
    assert.equal((await punch(employee, 'in', key, position())).id, session);
    await assert.rejects(punch(employee, 'in', id(), position()), /già/);
    await assert.rejects(as(employee, 'update workspace_hr_attendance set checkout_at=now()'), /permission denied/);
    await assert.rejects(punch(manager, 'out', id(), null, session), /non trovata/);
  });
  await t.test('checkout requires confirmed departure; one outlier does not close attendance', async () => {
    assert.equal((await punch(employee, 'observe', id(), position(40.002), session)).checkout_at, null);
    await db.query("update workspace_hr_attendance set outside_since=now()-interval '31 seconds',last_outside_at=now()-interval '31 seconds' where id=$1", [session]);
    assert.equal((await punch(employee, 'observe', id(), position(), session)).checkout_at, null);
    assert.equal((await db.query('select outside_since from workspace_hr_attendance where id=$1', [session])).rows[0].outside_since, null);
    await punch(employee, 'observe', id(), position(40.002), session);
    await db.query("update workspace_hr_attendance set outside_since=now()-interval '31 seconds',last_outside_at=now()-interval '31 seconds' where id=$1", [session]);
    assert.ok((await punch(employee, 'observe', id(), position(40.002), session)).checkout_at);
    assert.equal((await db.query('select checkout_kind from workspace_hr_attendance where id=$1', [session])).rows[0].checkout_kind, 'automatic');
  });
  await t.test('manual checkout needs no GPS and is idempotent', async () => {
    const s = (await punch(employee, 'in', id(), position())).id;
    const out = await punch(employee, 'out', id(), null, s);
    assert.ok(out.checkout_at);
    assert.equal((await punch(employee, 'out', id(), null, s)).checkout_at, out.checkout_at);
  });
  await t.test('operational manager can plan shifts and closures but cannot edit agreements', async () => {
    await rpc(manager, 'workspace_hr_operate', ['closure', JSON.stringify({ name: 'Chiusura test', date_from: today, date_to: today })]);
    assert.equal((await snap(employee)).shifts.filter((s) => s.work_date === today).length, 0);
    const shift = { user_id: employee, date_from: today, date_to: today, weekdays: [1,2,3,4,5,6,7], start_time: '22:00', end_time: '06:00', break_minutes: 30, site_id: site };
    await assert.rejects(rpc(employee, 'workspace_hr_operate', ['shift', JSON.stringify(shift)]), /autorizzata/);
    await rpc(manager, 'workspace_hr_operate', ['shift', JSON.stringify(shift)]);
    const planned = (await snap(employee)).shifts.find((s) => s.work_date === today);
    assert.equal((Date.parse(planned.ends_at) - Date.parse(planned.starts_at)) / 3600000, 8);
    assert.equal(planned.break_minutes, 30);
    await assert.rejects(rpc(manager, 'workspace_hr_operate', ['shift', JSON.stringify({ ...shift, weekdays: [9] })]), /Giorni/);
  });
  await t.test('missing checkout correction requires another manager and a reason', async () => {
    const s = (await punch(employee, 'in', id(), position())).id;
    await assert.rejects(rpc(manager, 'workspace_hr_operate', ['correct_attendance', JSON.stringify({ id: s, checkout_at: new Date().toISOString() })]), /motivazione/);
    await assert.rejects(rpc(employee, 'workspace_hr_operate', ['correct_attendance', JSON.stringify({ id: s, checkout_at: new Date().toISOString(), note: 'Prova' })]), /autorizzata/);
    await rpc(manager, 'workspace_hr_operate', ['correct_attendance', JSON.stringify({ id: s, checkout_at: new Date().toISOString(), note: 'Uscita verificata' })]);
    assert.equal((await db.query('select checkout_kind from workspace_hr_attendance where id=$1', [s])).rows[0].checkout_kind, 'correction');
  });
  await t.test('requests use authenticated employee; approvals cannot be self-approved', async () => {
    const payload = { request_key: id(), user_id: outsider, kind: 'overtime', starts_at: `${today}T17:00:00Z`, ends_at: `${today}T18:00:00Z`, note: 'Attività aggiuntiva' };
    const req = await rpc(employee, 'workspace_hr_operate', ['request', JSON.stringify(payload)]);
    assert.equal((await db.query('select user_id from workspace_hr_requests where id=$1', [req.id])).rows[0].user_id, employee);
    assert.equal((await rpc(employee, 'workspace_hr_operate', ['request', JSON.stringify(payload)])).id, req.id);
    const review = JSON.stringify({ id: req.id, status: 'approved', note: 'Verificata' });
    await assert.rejects(rpc(employee, 'workspace_hr_operate', ['review', review]), /autorizzata/);
    await cfg('member', { user_id: employee, manager: true });
    await assert.rejects(rpc(employee, 'workspace_hr_operate', ['review', review]), /tua richiesta/);
    await cfg('member', { user_id: employee, manager: false });
    await rpc(manager, 'workspace_hr_operate', ['review', review]);
    assert.equal((await snap(employee)).requests[0].status, 'approved');
    await assert.rejects(rpc(manager, 'workspace_hr_operate', ['review', review]), /già/);
  });
  await t.test('multiple company recipients receive once and can only review requests', async () => {
    await assert.rejects(rpc(employee,'workspace_hr_save_recipients',[[outsider]]),/admin/);
    await rpc(admin,'workspace_hr_save_recipients',[[outsider,manager,outsider]]);
    assert.equal((await snap(admin,true)).recipients.length,2);
    const payload={request_key:id(),kind:'leave',starts_at:'2030-01-01T08:00:00Z',ends_at:'2030-01-01T09:00:00Z',note:'Ferie'};
    const req=await rpc(employee,'workspace_hr_operate',['request',JSON.stringify(payload)]);
    await rpc(employee,'workspace_hr_operate',['request',JSON.stringify(payload)]);
    assert.equal((await db.query('select count(*)::integer count from notifiche')).rows[0].count,2);
    const reviewSnapshot=await snap(outsider);
    assert.equal(reviewSnapshot.reviewer,true);
    assert.equal(reviewSnapshot.manager,false);
    assert.equal(reviewSnapshot.member,false);
    assert.equal(reviewSnapshot.attendance.length,0);
    assert.equal(reviewSnapshot.shifts.length,0);
    assert.equal('contracts' in reviewSnapshot,false);
    assert.ok(reviewSnapshot.requests.some(r=>r.id===req.id));
    await assert.rejects(snap(outsider,true),/admin/);
    await assert.rejects(rpc(outsider,'workspace_hr_operate',['closure',JSON.stringify({name:'test'})]),/autorizzata/);
    await rpc(outsider,'workspace_hr_operate',['review',JSON.stringify({id:req.id,status:'approved',note:'Approvata'})]);
    await assert.rejects(rpc(manager,'workspace_hr_operate',['review',JSON.stringify({id:req.id,status:'approved',note:'Ripetuta'})]),/già/);
    await rpc(admin,'workspace_hr_save_recipients',[[]]);
    await assert.rejects(snap(outsider),/abilitato/);
  });
  await t.test('removing HR department revokes HR without removing operational department', async () => {
    await writeFile(new URL('../.tmp/hr-fixtures.json', import.meta.url), JSON.stringify({ employee: await snap(employee), manager: await snap(manager), admin: await snap(admin, true) }));
    await rpc(admin, 'workspace_save_user_access', [employee, normalRole, [dept], '[]', true]);
    await assert.rejects(snap(employee), /abilitato/);
    assert.equal((await db.query('select reparto_id from utenti_reparti where utente_id=$1', [employee])).rows[0].reparto_id, dept);
    const archived = await snap(manager);
    assert.equal(archived.employees.find((e) => e.user_id === employee).active, false);
    assert.ok(archived.attendance.some((a) => a.user_id === employee));
    assert.equal(archived.shifts.filter((s) => s.user_id === employee && s.work_date >= today).length, 0);
  });
  await db.close();
});

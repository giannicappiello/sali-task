import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '../.tmp/hr-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';

const id = () => randomUUID();
test('Configurable smartphone GPS policy and catalog in isolated PostgreSQL', async (t) => {
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

  await db.exec(`alter table workspace_moduli add column aree text[];
    alter table workspace_moduli_schermate add primary key(modulo_codice,schermata_codice);
    alter table workspace_schermate add column area text, add column aree text[], add column protetta boolean, add column attiva boolean default true;
    alter table ruoli add column livello_accesso text default 'lettura';
    create table workspace_aree(codice text primary key,nome text,icona text,ordine integer,attiva boolean,protetta boolean);
    create table ruoli_moduli(ruolo_id uuid,modulo text,livello_accesso text);
    create function workspace_area_access_codes(uuid) returns text[] language sql stable as $$ select '{}'::text[] $$;
    create table workspace_hr_employee_recipients(employee_id uuid,reviewer_id uuid);
    insert into workspace_moduli(codice,nome,attivo) values('impostazioni','Impostazioni',true);
    create table test_department_modules(reparto_id uuid,modulo text);
    create or replace function workspace_module_enabled_for_user(target_user_id uuid,target_module text) returns boolean language sql stable security definer as $$
      select exists(select 1 from utenti u join ruoli r on r.id=u.ruolo_id where u.id=target_user_id and u.attivo and
       (r.amministratore_workspace or exists(select 1 from ruoli_moduli rm where rm.ruolo_id=u.ruolo_id and rm.modulo=target_module) or
        exists(select 1 from utenti_reparti ur join test_department_modules dm on dm.reparto_id=ur.reparto_id where ur.utente_id=u.id and dm.modulo=target_module))) $$;
  `);
  // Use the actual screen resolver for grants and personal denies.
  const access = await readFile(new URL('../supabase/migrations/20260912210000_workspace_multiple_screen_areas.sql',import.meta.url),'utf8');
  await db.exec(access.slice(access.indexOf('CREATE OR REPLACE FUNCTION public.workspace_screen_level_for_user'),access.indexOf('CREATE OR REPLACE FUNCTION public.workspace_session_access')));
  await db.exec(await readFile(new URL('../supabase/migrations/20260925190000_hr_location_and_overtime_conversion.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261004120000_hr_geolocation_settings.sql',import.meta.url),'utf8'));
  const rpc = async (user, fn, args=[]) => (await as(user, `select ${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args))[0].value;
  const cfg = (action,payload)=>rpc(admin,'workspace_hr_configure',[action,JSON.stringify(payload)]);
  const hr=(await db.query('select id from reparti where workspace_hr')).rows[0].id;
  await rpc(admin,'workspace_save_user_access',[employee,normalRole,[hr],'[]',true]);
  const site=(await cfg('site',{name:'Sede GPS',latitude:40,longitude:14,auto_checkout:true})).id;
  const position=(distance=0,accuracy=18)=>JSON.stringify({latitude:40+distance/6371000*180/Math.PI,longitude:14,accuracy,sampled_at:new Date().toISOString()});
  const punch=(action,distance=0,accuracy=18,attendance=null)=>rpc(employee,'workspace_hr_location_punch',[action,id(),position(distance,accuracy),attendance,null]);
  await t.test('catalog, area, route, default settings and no direct table access',async()=>{
    const screen=(await db.query("select * from workspace_schermate where codice='impostazioni.geolocalizzazione'")).rows[0];
    assert.equal(screen.percorso,'/settings/geolocation'); assert.equal(screen.area,'configurazioni');
    assert.equal((await db.query("select modulo_codice from workspace_moduli_schermate where schermata_codice=$1",[screen.codice])).rows[0].modulo_codice,'altre_impostazioni');
    assert.equal((await db.query("select voce_codice from workspace_menu_moduli where modulo_codice='altre_impostazioni'")).rows[0].voce_codice,'impostazioni');
    const c=await rpc(admin,'workspace_hr_geolocation_settings'); assert.equal(c.presence_radius,150); assert.equal(c.max_accuracy,30);
    await assert.rejects(as(employee,'select * from workspace_hr_geolocation_config'),/permission denied/);
    await assert.rejects(rpc(outsider,'workspace_hr_geolocation_settings'),/non autorizzato/);
  });
  await t.test('role assignment reads; department assignment writes; personal deny blocks',async()=>{
    await db.query("insert into ruoli_moduli values($1,'altre_impostazioni','lettura')",[normalRole]);
    assert.equal((await rpc(manager,'workspace_hr_geolocation_settings')).max_accuracy,30);
    await assert.rejects(rpc(manager,'workspace_hr_save_geolocation_settings',[200,40]),/non autorizzato/);
    await db.exec('delete from ruoli_moduli');
    await db.query('insert into utenti_reparti values($1,$2)',[manager,dept]);
    await db.query("insert into test_department_modules values($1,'altre_impostazioni')",[dept]);
    await db.query("update ruoli set livello_accesso='scrittura' where id=$1",[normalRole]);
    assert.equal((await rpc(manager,'workspace_hr_save_geolocation_settings',[200,40])).presence_radius,200);
    await db.query("insert into workspace_eccezioni_utente(utente_id,ambito,codice,decisione) values($1,'schermata','impostazioni.geolocalizzazione','nega')",[manager]);
    await assert.rejects(rpc(manager,'workspace_hr_geolocation_settings'),/non autorizzato/);
    await assert.rejects(rpc(admin,'workspace_hr_save_geolocation_settings',[0,30]),/positivi/);
    await rpc(admin,'workspace_hr_save_geolocation_settings',[150,30]);
  });
  let session;
  await t.test('valid entry; inside movement near the configured radius leaves PRESENTE',async()=>{
    session=(await punch('in',42)).id;
    for(const d of [42,80,149.99]) assert.equal((await punch('observe',d,18,session)).checkout_at,null);
    assert.equal((await db.query('select checkout_at from workspace_hr_attendance where id=$1',[session])).rows[0].checkout_at,null);
  });
  await t.test('poor accuracy cannot alter present state or create an entry',async()=>{
    const before=(await db.query('select * from workspace_hr_attendance where id=$1',[session])).rows[0];
    assert.equal((await punch('observe',186,31,session)).ignored,true);
    assert.deepEqual((await db.query('select * from workspace_hr_attendance where id=$1',[session])).rows[0],before);
    assert.equal((await punch('out',42,31,session)).ignored,true);
    const stale=JSON.parse(position(186,12)); stale.sampled_at=new Date(Date.now()-60000).toISOString();
    await assert.rejects(rpc(employee,'workspace_hr_location_punch',['observe',id(),JSON.stringify(stale),session,null]),/scaduta/);
    assert.deepEqual((await db.query('select * from workspace_hr_attendance where id=$1',[session])).rows[0],before);
  });
  await t.test('one valid outside reading closes immediately with full diagnostic audit; retry is idempotent',async()=>{
    const result=await punch('observe',150.1,30,session);
    assert.ok(result.checkout_at); assert.equal(result.checkout_kind,'automatic');
    assert.equal((await punch('observe',186,12,session)).checkout_at,result.checkout_at);
    const audit=(await db.query("select details from workspace_hr_audit where target_id=$1 and action='punch.observe'",[session])).rows;
    assert.equal(audit.length,1); assert.equal(audit[0].details.event_type,'USCITA');
    for(const key of ['user_id','observed_at','latitude','longitude','accuracy','distance','presence_radius','max_accuracy','evaluation','gps_error']) assert.ok(key in audit[0].details);
    assert.equal(audit[0].details.presence_radius,150); assert.equal(audit[0].details.max_accuracy,30);
    const before=(await db.query('select count(*)::integer as n from workspace_hr_attendance')).rows[0].n;
    assert.equal((await punch('in',0,31)).ignored,true);
    assert.equal((await db.query('select count(*)::integer as n from workspace_hr_attendance')).rows[0].n,before);
  });
  await t.test('changed settings immediately control entry and an existing open presence; history untouched',async()=>{
    const closed=(await db.query('select * from workspace_hr_attendance where id=$1',[session])).rows[0];
    await rpc(admin,'workspace_hr_save_geolocation_settings',[200,40]);
    const opened=(await punch('in',180,40)).id;
    assert.equal((await punch('observe',186,40,opened)).checkout_at,null);
    await rpc(admin,'workspace_hr_save_geolocation_settings',[150,30]);
    assert.equal((await punch('observe',186,40,opened)).ignored,true);
    assert.equal((await punch('observe',186,12,opened)).checkout_kind,'automatic');
    assert.deepEqual((await db.query('select * from workspace_hr_attendance where id=$1',[session])).rows[0],closed);
    await assert.rejects(punch('in',186,12),/Avvicinati/);
  });

  await t.test('installed Altre impostazioni module and its menu membership are reused without duplicate module',async()=>{
    await db.exec("delete from workspace_moduli_schermate where schermata_codice in ('impostazioni.geolocalizzazione','impostazioni.altre'); delete from workspace_schermate where codice in ('impostazioni.geolocalizzazione','impostazioni.altre'); update workspace_moduli set codice='installed_other' where codice='altre_impostazioni'; update workspace_menu_moduli set modulo_codice='installed_other' where modulo_codice='altre_impostazioni';");
    const migration=await readFile(new URL('../supabase/migrations/20261004120000_hr_geolocation_settings.sql',import.meta.url),'utf8');
    const block=migration.slice(migration.indexOf('do ' + String.fromCharCode(36,36)),migration.indexOf('create function public.workspace_hr_geolocation_settings'));
    await db.exec(block);
    assert.equal((await db.query("select modulo_codice from workspace_moduli_schermate where schermata_codice='impostazioni.geolocalizzazione'")).rows[0].modulo_codice,'installed_other');
    assert.equal((await db.query("select count(*)::integer as n from workspace_moduli where nome='Altre impostazioni'")).rows[0].n,1);
    assert.equal((await db.query("select count(*)::integer as n from workspace_menu_moduli where modulo_codice='installed_other'")).rows[0].n,1);
    // Production uses the code impostazioni for the Altre Impostazioni module.
    await db.exec("delete from workspace_moduli_schermate where schermata_codice in ('impostazioni.geolocalizzazione','impostazioni.altre'); delete from workspace_schermate where codice in ('impostazioni.geolocalizzazione','impostazioni.altre'); delete from workspace_moduli where codice='impostazioni'; update workspace_moduli set codice='impostazioni' where codice='installed_other'; update workspace_menu_moduli set modulo_codice='impostazioni' where modulo_codice='installed_other';");
    await db.exec(block);
    assert.equal((await db.query("select modulo_codice from workspace_moduli_schermate where schermata_codice='impostazioni.geolocalizzazione'")).rows[0].modulo_codice,'impostazioni');
    assert.equal((await db.query("select count(*)::integer as n from workspace_moduli_schermate where schermata_codice='impostazioni.altre'")).rows[0].n,1);
  });
});

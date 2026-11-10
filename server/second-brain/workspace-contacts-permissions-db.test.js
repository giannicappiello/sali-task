/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { workspaceContactTools } from './workspace-contacts.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const migration = await read('../../supabase/migrations/20261109183337_workspace_contacts_ai_module.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const names = ['public.workspace_ai_capabilities()', 'public.admin_ai_effective_access(uuid)'];
const oldLists = [
  "('attivita','prodotti','documenti','beauty_days','ordini_pr','ordini_ph','progremes','ordini_private','human_resources','hr','crm_conto_terzi','crm_b2b','crm_online')",
  "('attivita','prodotti','documenti','beauty_days','ordini_pr','ordini_ph','progremes')",
];
const addMessages = list => list.slice(0, -1) + ",'messaggi')";
const newFunction = (sql, name) => sql.slice(sql.indexOf(`create or replace function public.${name}`), sql.indexOf('$$;', sql.indexOf(`create or replace function public.${name}`)) + 3);

async function fixture(PGlite) {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create role authenticated;
    create role anon;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table ruoli(id uuid primary key, amministratore_workspace boolean, livello_ai text);
    create table utenti(id uuid primary key, auth_user_id uuid, ruolo_id uuid, reparto_id uuid, nome text, cognome text, email text, attivo boolean);
    create table utenti_reparti(utente_id uuid, reparto_id uuid);
    create table workspace_moduli(codice text primary key,nome text,ordine int,attivo boolean);
    create table ai_reparti_moduli(reparto_id uuid,modulo_codice text,consentito boolean,riconoscimento_immagini boolean);
    create table ai_utenti_moduli(utente_id uuid,modulo_codice text,consentito boolean,riconoscimento_immagini boolean);
    create table ruoli_moduli(ruolo_id uuid,modulo text,livello_accesso text);
    create table ai_reparti_capacita(reparto_id uuid,dati_interni boolean,ricerca_web boolean,ordini boolean,progremes boolean,pianificazione boolean,applicazione_piani boolean,riconoscimento_immagini boolean,limite_richieste_mese int,limite_spesa_utente_mese_usd numeric,limite_documenti_giorno int,massimo_pagine_documento int,costo_massimo_operazione_usd numeric);
    create table ai_utilizzo_mensile(utente_id uuid,mese date,richieste int,costo_usd numeric);
    create table fixture_module_access(user_id uuid,module text,allowed boolean);
    create function public.workspace_module_enabled_for_user(target_user_id uuid,target_module text) returns boolean language sql stable as $$select coalesce((select allowed from fixture_module_access where user_id=target_user_id and module=target_module),false)$$;
    create function public.workspace_user_is_admin() returns boolean language sql stable as $$select exists(select 1 from utenti u join ruoli r on r.id=u.ruolo_id where u.auth_user_id=auth.uid() and u.attivo is not false and r.amministratore_workspace)$$;
    insert into ruoli values ('${id(101)}',true,'conferma'),('${id(102)}',false,'analisi');
    insert into utenti values ('${id(1)}','${id(1)}','${id(101)}','${id(201)}','Admin','Fixture','admin@example.test',true),('${id(2)}','${id(2)}','${id(102)}','${id(202)}','Reader','Fixture','reader@example.test',true);
    insert into workspace_moduli values ('messaggi','Messaggi',80,true),('attivita','Attività',20,true),('prodotti','Prodotti',60,true),('assistente_ai','AI',70,true);
    insert into fixture_module_access values ('${id(2)}','messaggi',true),('${id(2)}','attivita',true),('${id(2)}','assistente_ai',true);
    insert into ai_reparti_capacita(reparto_id,dati_interni,ricerca_web,limite_richieste_mese) values ('${id(202)}',true,false,100);
    insert into ai_reparti_moduli values ('${id(202)}','attivita',true,false);
  `);
  const capabilities = await read('../../supabase/migrations/20260924070000_ai_operational_read_permissions.sql');
  const inspector = await read('../../supabase/migrations/20260821130000_role_ai_level_and_boolean_module_access.sql');
  await db.exec(newFunction(capabilities, 'workspace_ai_capabilities') + newFunction(inspector, 'admin_ai_effective_access'));
  await db.exec(`revoke all on function public.workspace_ai_capabilities(), public.admin_ai_effective_access(uuid) from public,anon; grant execute on function public.workspace_ai_capabilities(), public.admin_ai_effective_access(uuid) to authenticated;`);
  return db;
}
const definition = async (db, name) => (await db.query('select pg_get_functiondef($1::regprocedure) as definition', [name])).rows[0].definition;
const acl = async db => (await db.query("select proname,proacl::text,prosecdef,proconfig from pg_proc where oid in ('public.workspace_ai_capabilities()'::regprocedure,'public.admin_ai_effective_access(uuid)'::regprocedure) order by proname")).rows;
const asUser = async (db, n, sql = 'select workspace_ai_capabilities() as value', params = []) => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(n)]);
  await db.exec('set role authenticated');
  try { return (await db.query(sql, params)).rows[0].value; }
  finally { await db.exec('reset role'); }
};
const contactsExposed = (caps, n = 2) => Boolean(workspaceContactTools({ profile: { id: id(n), attivo: true, ruoli: { amministratore_workspace: n === 1 } }, capabilities: caps || {}, access: { modules: ['messaggi'] } }).WORKSPACE_CONTACTS_SEARCH);

// Runtime dependency is optional in the normal suite, as for other DB fixtures.
test('installed AI functions only add Messaggi and preserve ACLs, other modules and every existing gate', { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE);
  const db = await fixture(PGlite);
  try {
    const before = await Promise.all(names.map(name => definition(db, name)));
    const beforeAcl = await acl(db);
    const adminBefore = await asUser(db, 1), readerBefore = await asUser(db, 2);
    assert.equal(contactsExposed(adminBefore, 1), false);
    await db.exec(migration);
    const after = await Promise.all(names.map(name => definition(db, name)));
    after.forEach((text, index) => assert.equal(text, before[index].replace(oldLists[index], addMessages(oldLists[index]))));
    assert.deepEqual(await acl(db), beforeAcl);
    const adminAfter = await asUser(db, 1);
    assert.deepEqual({ ...adminAfter, allowed_modules: adminAfter.allowed_modules.filter(code => code !== 'messaggi') }, adminBefore);
    assert.equal(contactsExposed(adminAfter, 1), true);
    assert.deepEqual(await asUser(db, 2), readerBefore);
    assert.equal(contactsExposed(readerBefore), false);
    assert.equal((await db.query("select count(*)::int as count from ai_reparti_moduli where modulo_codice='messaggi'")).rows[0].count, 0);
    assert.equal((await db.query('select count(*)::int as count from ai_utenti_moduli')).rows[0].count, 0);

    // Department grants and personal exceptions use the existing precedence.
    await db.exec(`insert into ai_reparti_moduli values ('${id(202)}','messaggi',true,false)`);
    assert.equal(contactsExposed(await asUser(db, 2)), true);
    await db.exec(`insert into ai_utenti_moduli values ('${id(2)}','messaggi',false,false)`);
    assert.equal(contactsExposed(await asUser(db, 2)), false);
    let inspected = await asUser(db, 1, 'select admin_ai_effective_access($1::uuid) as value', [id(2)]);
    assert.equal(inspected.modules.find(module => module.code === 'messaggi').allowed, false);
    await db.exec(`update ai_reparti_moduli set consentito=false where modulo_codice='messaggi'; update ai_utenti_moduli set consentito=true`);
    assert.equal(contactsExposed(await asUser(db, 2)), true);
    inspected = await asUser(db, 1, 'select admin_ai_effective_access($1::uuid) as value', [id(2)]);
    assert.equal(inspected.modules.find(module => module.code === 'messaggi').allowed, true);
    assert.equal((await asUser(db, 2, 'select admin_ai_effective_access($1::uuid) as value', [id(2)])).error !== undefined, true);

    // A personal AI allow cannot override ordinary module denial or role denial.
    await db.exec("update fixture_module_access set allowed=false where module='messaggi'");
    assert.equal(contactsExposed(await asUser(db, 2)), false);
    await db.exec("update fixture_module_access set allowed=true where module='messaggi'; update ruoli set livello_ai='nessuno' where not amministratore_workspace");
    const noAi = await asUser(db, 2);
    assert.equal(noAi.internal_data, false); assert.equal(contactsExposed(noAi), false);
    await db.exec("update ruoli set livello_ai='analisi' where not amministratore_workspace; update ai_reparti_capacita set dati_interni=false");
    const noInternalData = await asUser(db, 2);
    assert.equal(noInternalData.internal_data, false); assert.equal(contactsExposed(noInternalData), false);
    await db.exec("update ai_reparti_capacita set dati_interni=true; update workspace_moduli set attivo=false where codice='messaggi'");
    assert.equal(contactsExposed(await asUser(db, 2)), false);
    await db.exec(`update workspace_moduli set attivo=true where codice='messaggi'; update utenti set attivo=false where id='${id(2)}'`);
    assert.equal(await asUser(db, 2), null);

    await db.exec(migration);
    assert.deepEqual(await Promise.all(names.map(name => definition(db, name))), after);
    assert.deepEqual(await acl(db), beforeAcl);
  } finally { await db.close(); }
});

test('migration refuses unexpected installed allowlists atomically', { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE);
  const db = await fixture(PGlite);
  try {
    const capabilitiesBefore = await definition(db, names[0]);
    const inspector = await definition(db, names[1]);
    const changed = inspector.replace(oldLists[1], oldLists[1].replace("'progremes'", "'future_module'"));
    await db.exec(changed);
    await assert.rejects(db.exec(migration), /Unexpected AI module allowlist/);
    await db.exec('rollback');
    assert.equal(await definition(db, names[0]), capabilitiesBefore);
    assert.equal(await definition(db, names[1]), changed);
  } finally { await db.close(); }
});

test('AI settings exposes registered modules including Anomalie and Magazzino without changing defaults', async () => {
  const source = await read('../../src/pages/Settings/AISettings.jsx');
  const list = JSON.parse(source.match(/const AI_MODULE_CODES = new Set\((\[[^;]+\])\);/)[1]);
  assert.deepEqual(new Set(list), new Set(['anomalie', 'magazzino', 'messaggi', 'attivita', 'prodotti', 'documenti', 'beauty_days', 'ordini_pr', 'ordini_ph', 'ordini_private', 'progremes', 'human_resources', 'hr', 'crm_conto_terzi', 'crm_b2b', 'crm_online']));
  assert.match(source, /return \{ consentito: false, riconoscimento_immagini: false/);
  assert.match(source, /supabase\.rpc\("admin_ai_effective_access"/);
  assert.doesNotMatch(migration, /\bgrant\s+(?:execute|select|all)\b|\binsert\s+into\b|\bupdate\s+public\./i);
});

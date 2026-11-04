import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Disposable PostgreSQL only. Use PGLITE_MODULE for a separate test runtime.
const {PGlite} = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const read = p => readFile(new URL(p, import.meta.url), 'utf8');
const original = await read('../migrations/20260915160000_chat_department_directory.sql');
const admin = await read('../migrations/20260917223000_chat_admin_all_users.sql');
const migration = await read('../migrations/20261104110000_private_customer_chat_team_only.sql');
const fixture = await read('../../test/chat-scope-fixtures.sql');
const [setup, assertions] = fixture.replaceAll('pg_temp.', 'public.').replaceAll('create temp table', 'create table').split('-- ASSERTIONS');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;

test('private customer messaging is limited to Progre staff at the database boundary', async t => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create role anon; create role authenticated;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
    await db.exec(setup);
    await db.exec('create table public.workspace_customer_user_links(user_id uuid,customer_code text);');
    for (const source of [original, admin])
      await db.exec(source.match(/create or replace function[\s\S]*?\$\$;/g).join('\n'));
    await db.exec((original.match(/create trigger[^;]+;/g)||[]).join('\n'));
    await db.exec(migration);
    const actor = uid => db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
    const q = async (sql,args=[]) => (await db.query(sql,args)).rows;
    const denied = async action => assert.rejects(action, e => e.code === '42501');

    await t.test('preserves existing staff permissions, groups, history and attachment rules', async () => {
      await db.exec('begin');
      try { await db.exec(assertions); } finally { await db.exec('rollback'); }
    });

    await db.query(`insert into ruoli(id,nome) values($1,'Cliente'),($2,'Collaboratore esterno');
    `,[id(5),id(6)]);
    await db.query("insert into reparti(id,nome,attivo) values($1,'Cliente Private',true)",[id(14)]);
    for (const [uid,role,dept] of [[100,1,14],[101,5,14],[102,3,12],[103,6,11]]) {
      await db.query("insert into utenti(id,auth_user_id,nome,cognome,ruolo_id,reparto_id) values($1,$1,$2,'Test',$3,$4)",[id(uid),'Fixture '+uid,id(role),id(dept)]);
    }
    await db.query("insert into workspace_customer_user_links values($1,'501.00001')",[id(100)]);
    await db.query('insert into utenti_reparti values($1,$2),($1,$3)',[id(102),id(14),id(11)]);

    await t.test('recognizes linked customers, customer roles and additional Private departments', async () => {
      for (const uid of [100,101,102]) assert.equal((await q('select chat_is_customer($1) value',[id(uid)]))[0].value,true);
      assert.equal((await q('select chat_is_team_member($1) value',[id(103)]))[0].value,false);
    });
    await t.test('rejects customer pairs regardless of shared department or leadership', async () => {
      for (const a of [100,101,102]) for (const b of [100,101,102]) if(a!==b)
        assert.equal((await q('select chat_pair_allowed($1,$2) value',[id(a),id(b)]))[0].value,false);
      await actor(id(100));
      await denied(()=>q('select chat_create_direct($1)',[id(101)]));
      await db.exec('begin');
      try {
        await db.query('update utenti set ruolo_id=$1 where id=$2',[id(4),id(100)]);
        assert.equal((await q('select chat_pair_allowed($1,$2) value',[id(100),id(101)]))[0].value,false);
      } finally { await db.exec('rollback'); }
    });
    await t.test('directory contains only staff and self for a Private customer', async () => {
      await actor(id(100));
      const directory=(await q('select chat_directory() value'))[0].value;
      assert(directory.users.find(u=>u.id===id(100)).is_customer);
      assert(directory.users.some(u=>u.id===id(23) && u.is_team_member));
      for(const uid of [101,102,103]) assert(!directory.users.some(u=>u.id===id(uid)));
    });
    let direct;
    await t.test('allows customer-staff direct messages, replies and attachments', async () => {
      await actor(id(100));
      direct=(await q('select chat_create_direct($1) value',[id(23)]))[0].value;
      const message=(await q("insert into chat_messaggi(conversazione_id,mittente_id,messaggio) values($1,$2,'Fixture') returning id",[direct,id(100)]))[0].id;
      await q('insert into chat_allegati(conversazione_id,messaggio_id,caricato_da_id) values($1,$2,$3)',[direct,message,id(100)]);
      await actor(id(23));
      await q("insert into chat_messaggi(conversazione_id,mittente_id,messaggio) values($1,$2,'Reply fixture')",[direct,id(23)]);
      await actor(id(100));
      await denied(()=>q('select chat_create_direct($1)',[id(103)]));
    });
    await t.test('blocks group or membership routes that would connect two customers', async () => {
      await actor(id(100));
      await denied(()=>q("select chat_create_people_group('Fixture',array[$1,$2]::uuid[])",[id(101),id(25)]));
      await denied(()=>q('insert into chat_partecipanti(conversazione_id,utente_id) values($1,$2)',[direct,id(101)]));
      const group=(await q("select chat_create_department_group('Production',array[$1]::uuid[]) value",[id(11)]))[0].value;
      assert(!(await q('select utente_id from chat_partecipanti where conversazione_id=$1',[group])).some(p=>p.utente_id===id(102)));
      assert.equal((await q('select chat_can_send($1) value',[group]))[0].value,true);
    });
    await t.test('blocks sends and attachments in pre-existing customer-to-customer chats without deleting history', async () => {
      const legacy=id(200), message=id(201);
      // Model a conversation that predates the restriction, in this disposable DB only.
      await db.exec('alter table chat_partecipanti disable trigger chat_enforce_membership_scope; alter table chat_messaggi disable trigger chat_enforce_message_scope;');
      await q("insert into chat_conversazioni(id,tipo,created_by) values($1,'diretta',$2)",[legacy,id(100)]);
      await q('insert into chat_partecipanti values($1,$2,null),($1,$3,null)',[legacy,id(100),id(101)]);
      await q("insert into chat_messaggi(id,conversazione_id,mittente_id,messaggio) values($1,$2,$3,'Old fixture')",[message,legacy,id(100)]);
      await db.exec('alter table chat_partecipanti enable trigger chat_enforce_membership_scope; alter table chat_messaggi enable trigger chat_enforce_message_scope;');
      await actor(id(100));
      assert.equal((await q('select chat_can_send($1) value',[legacy]))[0].value,false);
      await denied(()=>q("insert into chat_messaggi(conversazione_id,mittente_id,messaggio) values($1,$2,'Blocked')",[legacy,id(100)]));
      await denied(()=>q('insert into chat_allegati(conversazione_id,messaggio_id,caricato_da_id) values($1,$2,$3)',[legacy,message,id(100)]));
      assert.equal((await q('select count(*)::int value from chat_messaggi where conversazione_id=$1',[legacy]))[0].value,1);
    });
    await t.test('helper functions are not exposed directly to anonymous or authenticated callers', async () => {
      const result=(await q("select has_function_privilege('anon','chat_is_customer(uuid)','execute') anon,has_function_privilege('authenticated','chat_is_customer(uuid)','execute') authenticated"))[0];
      assert.deepEqual(result,{anon:false,authenticated:false});
    });
  } finally {await db.close();}
});

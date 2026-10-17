import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('Club database: real PostgreSQL ledger, permissions and request lifecycle', async t => {
  const db = new PGlite();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  try {
    await db.exec(`
      create role authenticated; create role anon; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.auth',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select current_setting('role')$$;
      create table utenti(id uuid primary key,auth_user_id uuid,nome text,cognome text);
      create table crm_accounts(id uuid primary key,nome text,email text,tipo text);
      create table ordini_clienti_cache(codice_cliente text primary key,ragione_sociale text);
      create table prodotti(id uuid primary key,nome text);
      create table crm_customer_events(id uuid default gen_random_uuid(),account_id uuid,fase text,fonte text,dati jsonb,creato_da uuid);
      create table workspace_schermate(codice text primary key,nome text,descrizione text,provider text,percorso text,chiave_componente text,protetta boolean,attiva boolean,ordine integer,area text,icona text,metadati jsonb,ultima_sincronizzazione timestamptz);
      create table workspace_moduli_schermate(modulo_codice text,schermata_codice text,ordine integer,predefinita boolean,visibile_menu boolean,primary key(modulo_codice,schermata_codice));
      create function workspace_current_profile_id() returns uuid language sql stable security definer as $$select id from utenti where auth_user_id=auth.uid()$$;
      create function workspace_internal_user() returns boolean language sql stable as $$select coalesce(current_setting('test.internal',true),'true')='true'$$;
      create function crm_has_module_level(text,text) returns boolean language sql stable as $$select coalesce(current_setting('test.module',true),'true')='true'$$;
      create function workspace_screen_level_for_user(uuid,text) returns text language sql stable as $$select case when $1 is null or $2=current_setting('test.denied',true) then 'nessuno' else coalesce(nullif(current_setting('test.level',true),''),'amministrazione') end$$;
      grant usage on schema public,auth to authenticated,anon;
      grant execute on all functions in schema auth to authenticated,anon;
      insert into auth.users values('${id(1)}'),('${id(2)}'),('${id(3)}');
      insert into utenti values('${id(11)}','${id(1)}','Admin','Club');
      insert into crm_accounts values('${id(101)}','Cliente Uno','uno@example.test','online'),('${id(102)}','Cliente Due','due@example.test','online');
      insert into ordini_clienti_cache values('SHOP-A','Negozio A'),('SHOP-B','Negozio B');
      insert into prodotti values('${id(201)}','Prodotto');
      set test.auth='${id(1)}';set test.level='amministrazione';set test.internal='true';set test.module='true';
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261017120000_salidischia_club.sql', import.meta.url), 'utf8'));
    await db.exec(`insert into club_members(id,auth_user_id,crm_account_id,trusted_store_code) values('${id(301)}','${id(2)}','${id(101)}','SHOP-A'),('${id(302)}','${id(3)}','${id(102)}','SHOP-B');set role authenticated;`);
    const configPayload = { name: 'Programma base', cashback_percent: 5, reimbursement_modes: ['products', 'prizes', 'money'], delivery_methods: ['pickup', 'home'], cash_minimum: 20, cash_method: 'bank_transfer', shipping_fee: 4.9, shipping_payment: 'wallet', free_shipping_threshold: 30, effective_at: '2020-01-01T00:00:00Z' };
    let configId, configStamp, rewardId, requestId;
    await t.test('configuration validates amounts, saves a draft, publishes immutable versions', async () => {
      await assert.rejects(q('select club_save_configuration($1)', [{ ...configPayload, cashback_percent: -1 }]));
      configId = (await q('select club_save_configuration($1) as id', [configPayload]))[0].id;
      await db.exec('reset role;');
      configStamp = (await q('select updated_at::text as stamp from club_configurations where id=$1', [configId]))[0].stamp;
      await db.exec('set role authenticated;');
      await assert.rejects(q('select club_publish_configuration($1,null)', [configId]), /cambiata/);
      await q('select club_publish_configuration($1,$2)', [configId, configStamp]);
      await assert.rejects(q('select club_save_configuration($1,$2,$3)', [configPayload, configId, configStamp]), /bozza/);
      const draft = (await q('select club_save_configuration($1) as id', [{ ...configPayload, cashback_percent: 7 }]))[0].id;
      await assert.rejects(q('select club_save_configuration($1,$2,$3)', [configPayload, draft, '2020-01-01']), /modificata/);
    });
    await t.test('no direct write access, external/read-only users cannot approve or change configuration', async () => {
      await assert.rejects(q('insert into club_wallet_movements(member_id,kind,available_delta,reason) values($1,\'earn\',999,\'hack\')', [id(301)]), /permission denied/);
      await assert.rejects(q('update club_requests set status=\'approved\''), /permission denied/);
      await db.exec(`set test.level='lettura';`);
      await assert.rejects(q('select club_save_configuration($1)', [configPayload]), /non autorizzato/);
      await assert.rejects(q('select club_transition_request($1,\'approved\')', [id(999)]), /non autorizzato/);
      await db.exec(`set test.level='amministrazione';set test.internal='false';`);
      await assert.rejects(q('select club_admin_dashboard(current_date,current_date)'), /non autorizzato/);
      await db.exec(`set test.internal='true';set test.denied='crm.online.club.richieste';`);
      await assert.rejects(q('select club_admin_requests()'), /non autorizzato/);
      await db.exec(`set test.denied='';`);
    });
    await t.test('seed purchase credit and create product reward using CRM authority', async () => {
      rewardId = (await q('select club_save_reward($1) as id', [{ kind: 'products', product_id: id(201), name: 'Premio prodotto', description: '', budget_required: 15, stock: 3, delivery_methods: ['pickup', 'home'], active: true, valid_until: null }]))[0].id;
      await db.exec('reset role;');
      for (const [member, purchase, amount] of [[301, 401, 50], [302, 402, 2]]) {
        await q('insert into club_purchases(id,member_id,store_code,configuration_id,amount,cashback,idempotency_key) values($1,$2,$3,$4,$5,$6,$7)', [id(purchase), id(member), member === 301 ? 'SHOP-A' : 'SHOP-B', configId, amount * 20, amount, id(purchase + 100)]);
        await q('insert into club_wallet_movements(member_id,purchase_id,kind,available_delta,reason) values($1,$2,\'earn\',$3,\'Acquisto\')', [id(member), id(purchase), amount]);
      }
      await db.exec(`set role authenticated;set test.auth='${id(2)}';set test.internal='false';`);
    });
    const createRequest = async (key, delivery = 'pickup', details = {}) => (await q('select club_create_request($1,\'products\',null,$2,$3,$4) as id', [rewardId, delivery, details, id(key)]))[0].id;
    await t.test('request reserves exact budget and stock once, duplicate submit returns the same ID', async () => {
      requestId = await createRequest(601);
      assert.equal(await createRequest(601), requestId);
      await db.exec('reset role;');
      const wallet = (await q('select sum(available_delta) as available,sum(reserved_delta) as reserved from club_wallet_movements where member_id=$1', [id(301)]))[0];
      assert.equal(Number(wallet.available), 35); assert.equal(Number(wallet.reserved), 15);
      assert.equal((await q('select stock from club_rewards where id=$1', [rewardId]))[0].stock, 2);
      await db.exec(`set role authenticated;set test.auth='${id(3)}';`);
      await assert.rejects(createRequest(602), /insufficiente/);
      await db.exec(`set test.auth='${id(2)}';`);
      await assert.rejects(q('select club_transition_request($1,\'approved\')', [requestId]), /non autorizzato/);
      await assert.rejects(q('select * from club_requests'), /permission denied/);
    });
    await t.test('admin dashboard request card count and searchable paginated list agree', async () => {
      await db.exec(`set test.auth='${id(1)}';set test.internal='true';`);
      const dashboard = (await q('select club_admin_dashboard(current_date,current_date) as result'))[0].result;
      assert.equal(dashboard.pending_requests, 1); assert.equal(Number(dashboard.reserved_budget), 15);
      const list = (await q('select club_admin_requests(\'pending\',\'Cliente Uno\',0,25) as result'))[0].result;
      assert.equal(list.total, 1); assert.equal(list.rows[0].customer_name, 'Cliente Uno'); assert.equal(list.rows[0].id, requestId);
      assert.equal((await q('select club_admin_requests(\'pending\',\'Cliente Due\',0,25) as result'))[0].result.total, 0);
    });
    await t.test('approval is idempotent, records actor, does not spend the reserved budget', async () => {
      await q('select club_transition_request($1,\'approved\')', [requestId]);
      await q('select club_transition_request($1,\'approved\')', [requestId]);
      const list = (await q('select club_admin_requests(\'processing\') as result'))[0].result;
      assert.equal(list.total, 1); assert.equal(list.rows[0].approved_by, id(11));
      await db.exec('reset role;');
      assert.equal((await q('select count(*)::int as n from club_audit where event=\'REQUEST_APPROVED\' and entity_id=$1', [requestId]))[0].n, 1);
      assert.equal((await q('select count(*)::int as n from club_wallet_movements where request_id=$1', [requestId]))[0].n, 1);
      await db.exec('set role authenticated;');
    });
    await t.test('completion spends reserve once, requires reference, writes CRM journey event', async () => {
      await q('select club_transition_request($1,\'ready\')', [requestId]);
      await assert.rejects(q('select club_transition_request($1,\'completed\')', [requestId]), /riferimento/);
      await q('select club_transition_request($1,\'completed\',\'Ritiro verificato 123\')', [requestId]);
      await q('select club_transition_request($1,\'completed\',\'Ritiro verificato 123\')', [requestId]);
      await assert.rejects(q('select club_transition_request($1,\'cancelled\',\'stop\')', [requestId]), /non consentito/);
      await db.exec('reset role;');
      assert.equal(Number((await q('select sum(reserved_delta) as n from club_wallet_movements where request_id=$1', [requestId]))[0].n), 0);
      assert.equal((await q('select count(*)::int as n from crm_customer_events'))[0].n, 1);
      await db.exec('set role authenticated;');
    });
    await t.test('home delivery reserves shipping; rejection releases budget and restores stock once', async () => {
      await db.exec(`set test.auth='${id(2)}';set test.internal='false';`);
      await assert.rejects(createRequest(603, 'home'), /incompleto/);
      const homeRequest = await createRequest(603, 'home', { recipient: 'Cliente Uno', street: 'Via Prova 1', city: 'Ischia', postal_code: '80077', country: 'IT' });
      await db.exec(`set test.auth='${id(1)}';set test.internal='true';`);
      const list = (await q('select club_admin_requests() as result'))[0].result;
      assert.equal(Number(list.rows[0].reserved_amount), 19.9);
      await assert.rejects(q('select club_transition_request($1,\'rejected\')', [homeRequest]), /motivazione/);
      await q('select club_transition_request($1,\'rejected\',\'Cliente rinuncia\')', [homeRequest]);
      await q('select club_transition_request($1,\'rejected\',\'Cliente rinuncia\')', [homeRequest]);
      const members = (await q('select club_admin_members(\'Cliente Uno\') as result'))[0].result;
      assert.equal(Number(members.rows[0].available), 35); assert.equal(Number(members.rows[0].reserved), 0); assert.equal(Number(members.rows[0].used), 15);
      await db.exec('reset role;');
      assert.equal((await q('select stock from club_rewards where id=$1', [rewardId]))[0].stock, 2);
      await db.exec('set role authenticated;');
    });
    await t.test('cash redemption enforces threshold, separate request identity, no reward stock consumption', async () => {
      await db.exec(`set test.auth='${id(2)}';set test.internal='false';`);
      await assert.rejects(q('select club_create_request(null,\'money\',10,\'bank_transfer\',$1,$2)', [{ iban: 'TEST' }, id(604)]), /non valido/);
      const cashId = (await q('select club_create_request(null,\'money\',20,\'bank_transfer\',$1,$2) as id', [{ iban: 'TEST-ACCOUNT' }, id(604)]))[0].id;
      await db.exec(`set test.auth='${id(1)}';set test.internal='true';`);
      await q('select club_transition_request($1,\'approved\')', [cashId]);
      await q('select club_transition_request($1,\'completed\',\'BONIFICO-TEST\')', [cashId]);
      const rows = (await q('select club_admin_members(\'Cliente Uno\') as result'))[0].result.rows;
      assert.equal(Number(rows[0].available), 15); assert.equal(Number(rows[0].used), 35);
    });
  } finally { await db.close(); }
});

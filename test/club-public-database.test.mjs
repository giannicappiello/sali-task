import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

export async function createClubFixture() {
 const db = new PGlite();
 await db.exec(`
 create role anon;create role authenticated;create role service_role;create role authenticator;
 create schema auth;
 create table auth.users(id uuid primary key,email text not null,raw_user_meta_data jsonb not null default '{}',raw_app_meta_data jsonb not null default '{}',email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.auth',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('role')$$;
 create table ruoli(id uuid primary key,nome text,amministratore_workspace boolean);
 create table utenti(id uuid primary key default gen_random_uuid(),auth_user_id uuid unique,nome text,cognome text,email text unique,ruolo_id uuid,attivo boolean default true,updated_at timestamptz);
 create table crm_accounts(id uuid primary key default gen_random_uuid(),tipo text,nome text,stato text,fonte text,email text,telefono text,responsabile_id uuid,metadati jsonb);
 create table ordini_clienti_cache(codice_cliente text primary key,ragione_sociale text,indirizzo text,provincia text,cap text,attivo_mexal boolean default true);
 create view crm_classified_customers as select codice_cliente,'b2b'::text as area_crm from ordini_clienti_cache;
 create table prodotti(id uuid primary key,nome text,codice_mexal text,attivo_mexal boolean default true,mostra_in_app boolean default true);
 create table crm_customer_events(id uuid default gen_random_uuid(),account_id uuid,fase text,fonte text,dati jsonb,creato_da uuid);
 create table crm_marketing_consents(id uuid default gen_random_uuid(),account_id uuid,purpose text,status text,legal_basis text,source text,captured_at timestamptz,proof_reference text,responsabile_id uuid);
 create table workspace_schermate(codice text primary key,nome text,descrizione text,provider text,percorso text,chiave_componente text,protetta boolean,attiva boolean,ordine integer,area text,icona text,metadati jsonb,ultima_sincronizzazione timestamptz);
 create table workspace_moduli_schermate(modulo_codice text,schermata_codice text,ordine integer,predefinita boolean,visibile_menu boolean,primary key(modulo_codice,schermata_codice));
 create table company_secret(id integer);insert into company_secret values(1);alter table company_secret enable row level security;create policy fixture_base on company_secret for all to authenticated using(true) with check(true);grant select on company_secret to authenticated;
 create function workspace_current_profile_id() returns uuid language sql stable security definer as $$select id from utenti where auth_user_id=auth.uid() and attivo$$;
 create function workspace_internal_user() returns boolean language sql stable security definer as $$select exists(select 1 from utenti where auth_user_id=auth.uid() and attivo)$$;
 create function crm_has_module_level(text,text) returns boolean language sql stable as $$select workspace_current_profile_id() is not null$$;
 create function workspace_screen_level_for_user(uuid,text) returns text language sql stable as $$select case when $1 is null then 'nessuno' else 'amministrazione' end$$;
 create function handle_new_auth_user() returns trigger language plpgsql security definer as $$BEGIN
 INSERT INTO utenti(id,auth_user_id,nome,email,ruolo_id) VALUES(NEW.id,NEW.id,coalesce(NEW.raw_user_meta_data->>'nome','Operatore'),NEW.email,'${id(12)}');RETURN NEW;END$$;
 create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_auth_user();
 grant usage on schema auth,public to authenticated,anon;
 insert into ruoli values('${id(11)}','admin',true),('${id(12)}','operatore',false);
 insert into auth.users(id,email,email_confirmed_at) values('${id(1)}','admin@example.test',now());update utenti set ruolo_id='${id(11)}' where id='${id(1)}';
 insert into ordini_clienti_cache(codice_cliente,ragione_sociale,indirizzo,provincia,cap) values('A','Negozio A','Via A','NA','80077'),('B','Negozio B','Via B','NA','80078');
 insert into prodotti(id,nome,codice_mexal) values('${id(50)}','Crema Sali di Ischia','IT0492');
 set test.auth='${id(1)}';
 `);
 for (const name of ['20261017120000_salidischia_club.sql','20261017150000_salidischia_club_portal.sql','20261017151000_salidischia_club_documents.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 return db;
}

if (!process.env.CLUB_FIXTURE_ONLY) test('Club public portal: auth isolation, store boundaries and atomic cashback', async t => {
 const db=await createClubFixture();const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const actor=async number=>db.exec(`set test.auth='${id(number)}';set role authenticated;`);
 const root=()=>db.exec('reset role;');
 let info,memberA,memberB,tokenA,tokenB,purchaseId,requestId,rewardId;
 try {
  await t.test('Club signup never creates an internal operator; original signup remains compatible',async()=>{
   for(const n of [2,3,4,5,6])await q('insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values($1,$2,$3,now())',[id(n),`user${n}@example.test`,{club_app:'salidischia-club'}]);
   assert.equal((await q('select count(*)::int as n from utenti where auth_user_id<>$1',[id(1)]))[0].n,0);
   assert.equal((await q('select raw_app_meta_data from auth.users where id=$1',[id(2)]))[0].raw_app_meta_data.club_only,true);
   await assert.rejects(q('insert into utenti(auth_user_id,email) values($1,$2)',[id(2),'new@example.test']),/non possono/);
   await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id(7),'normal@example.test']);assert.equal((await q('select count(*)::int as n from utenti where auth_user_id=$1',[id(7)]))[0].n,1);
  });
  await t.test('shared Workspace data and unrelated RPC paths remain blocked for Club identities',async()=>{
   await actor(2);assert.equal((await q('select * from company_secret')).length,0);
   await db.exec(`set request.path='/rpc/workspace_session_access';`);await assert.rejects(q('select club_api_boundary()'),/riservato/);
   await db.exec(`set request.path='/rpc/club_member_portal';`);await q('select club_api_boundary()');
   await actor(1);assert.equal((await q('select * from company_secret')).length,1);
  });
  await t.test('documents are internal, drafts stay private, versions are immutable',async()=>{
   await actor(1);await q('select club_admin_public_settings($1)',[{crm_owner_id:id(1),support_email:'club@example.test'}]);
   assert.equal((await q('select club_public_info() as info'))[0].info.registration_available,false);
   for(const kind of ['program','privacy']){
    const doc=(await q('select club_save_document($1,$2,$3) as id',[kind,'Documento test '+kind,'# Documento di test\n\nTesto sufficiente per la verifica funzionale in ambiente isolato.']))[0].id;
    assert.equal((await q('select club_public_document($1) as doc',[kind]))[0].doc,null);
    await root();const stamp=(await q('select updated_at::text as stamp from club_documents where id=$1',[doc]))[0].stamp;await actor(1);
    await q('select club_publish_document($1,$2)',[doc,stamp]);
    await assert.rejects(q('select club_save_document($1,$2,$3,$4,$5)',[kind,'Changed','This must not modify a published document.',doc,stamp]),/non è modificabile/);
   }
   info=(await q('select club_public_info() as info'))[0].info;assert.equal(info.registration_available,true);assert.ok(info.privacy_url.startsWith('/regolamento?documento=privacy&version='));
  });
  await t.test('verified member joins CRM once, with versioned separate consents',async()=>{
   await actor(2);await assert.rejects(q('select club_enroll_member($1,$2,true,false,false,$3,$4)',['Cliente A','',null,null]),/documenti/);
   memberA=(await q('select club_enroll_member($1,$2,true,false,true,$3,$4) as id',['Cliente A','',info.terms_url,info.privacy_url]))[0].id;
   assert.equal((await q('select club_enroll_member($1,$2,true,false,true,$3,$4) as id',['Cliente A','',info.terms_url,info.privacy_url]))[0].id,memberA);
   assert.equal((await q('select club_session() as session'))[0].session.role,'member');
   await actor(3);memberB=(await q('select club_enroll_member($1,$2,true,false,false,$3,$4) as id',['Cliente B','',info.terms_url,info.privacy_url]))[0].id;
   await root();assert.equal((await q('select count(*)::int as n from crm_accounts'))[0].n,2);assert.equal((await q('select count(*)::int as n from club_consents'))[0].n,6);
  });
  await t.test('only CRM can enable stores and invite email-bound operators',async()=>{
   await actor(1);await q('select club_admin_enable_store(\'A\',true)');await q('select club_admin_enable_store(\'B\',true)');
   tokenA=(await q('select club_admin_invite_store(\'A\',\'user4@example.test\') as token'))[0].token;
   tokenB=(await q('select club_admin_invite_store(\'B\',\'user5@example.test\') as token'))[0].token;
   await actor(6);await assert.rejects(q('select club_claim_store_invite($1)',[tokenA]),/destinatario/);
   await actor(4);await q('select club_claim_store_invite($1)',[tokenA]);await actor(5);await q('select club_claim_store_invite($1)',[tokenB]);
   await actor(2);await q('select club_select_store(\'A\')');await actor(3);await q('select club_select_store(\'B\')');
   await actor(4);const stores=(await q('select club_store_portal() as result'))[0].result;assert.equal(stores.total,1);assert.equal(stores.rows[0].name,'Cliente A');
   await assert.rejects(q('select club_admin_stores()'),/non autorizzato/);
  });
  let codeA,codeB;
  await t.test('store cannot query a known member ID/code belonging to another store',async()=>{
   await actor(2);codeA=(await q('select club_member_portal() as portal'))[0].portal.member.member_code;
   await actor(3);codeB=(await q('select club_member_portal() as portal'))[0].portal.member.member_code;
   await actor(4);await assert.rejects(q('select club_lookup_member($1)',[codeB]),/non disponibile/);assert.equal((await q('select club_lookup_member($1) as member',[codeA]))[0].member.id,memberA);
  });
  await t.test('store purchase atomically saves products, wallet and CRM; duplicate cannot earn twice',async()=>{
   await actor(1);const config={name:'Test 5%',cashback_percent:5,reimbursement_modes:['products','prizes'],delivery_methods:['pickup','home'],cash_minimum:20,cash_method:'bank_transfer',shipping_fee:0,shipping_payment:'company',free_shipping_threshold:null,effective_at:'2020-01-01'};
   const configId=(await q('select club_save_configuration($1) as id',[config]))[0].id;await root();const stamp=(await q('select updated_at::text as stamp from club_configurations where id=$1',[configId]))[0].stamp;await actor(1);await q('select club_publish_configuration($1,$2)',[configId,stamp]);
   rewardId=(await q('select club_save_reward($1) as id',[{kind:'products',product_id:id(50),name:'Premio crema',description:'',budget_required:5,stock:5,delivery_methods:['pickup'],active:true,valid_until:null}]))[0].id;
   await actor(4);const items=[{product_id:id(50),quantity:2,amount:200}];purchaseId=(await q('select club_record_purchase($1,$2,$3) as p',[codeA,items,id(60)]))[0].p.id;assert.equal((await q('select club_record_purchase($1,$2,$3) as p',[codeA,items,id(60)]))[0].p.id,purchaseId);
   await assert.rejects(q('select club_record_purchase($1,$2,$3)',[codeB,items,id(61)]),/non disponibile/);
   await actor(2);const portal=(await q('select club_member_portal() as p'))[0].p;assert.equal(Number(portal.wallet.available),10);assert.equal(portal.rewards.length,1);assert.equal((await q('select club_member_history(\'purchases\') as h'))[0].h.rows[0].items[0].quantity,2);
  });
  await t.test('member requests reward; shop cannot approve; handover requires customer code and spends once',async()=>{
   await actor(2);requestId=(await q('select club_create_request($1,\'products\',null,\'pickup\',\'{}\',$2) as id',[rewardId,id(70)]))[0].id;
   const pickupCode=(await q('select club_member_history(\'requests\') as h'))[0].h.rows[0].pickup_code;
   await actor(4);await assert.rejects(q('select club_transition_request($1,\'approved\')',[requestId]),/non autorizzato/);
   await actor(1);await q('select club_transition_request($1,\'approved\')',[requestId]);await actor(4);
   assert.ok(!Object.hasOwn((await q('select club_store_pickups() as rows'))[0].rows[0],'pickup_code'));
   await assert.rejects(q('select club_store_handover($1,\'WRONG\')',[requestId]),/non valido/);
   await q('select club_store_handover($1,$2)',[requestId,pickupCode]);await q('select club_store_handover($1,$2)',[requestId,pickupCode]);
   await actor(2);const portal=(await q('select club_member_portal() as p'))[0].p;assert.equal(Number(portal.wallet.available),5);assert.equal(Number(portal.wallet.used),5);
  });
  await t.test('purchase reversal is atomic, idempotent and refuses cashback already used',async()=>{
   await actor(4);await assert.rejects(q('select club_reverse_purchase($1,\'reso\')',[purchaseId]),/utilizzato o riservato/);
   const p=(await q('select club_record_purchase($1,$2,$3) as p',[codeA,[{product_id:id(50),quantity:1,amount:40}],id(80)]))[0].p;
   await q('select club_reverse_purchase($1,\'reso completo\')',[p.id]);await q('select club_reverse_purchase($1,\'reso completo\')',[p.id]);
   await actor(2);assert.equal(Number((await q('select club_member_portal() as p'))[0].p.wallet.available),5);
  });
  await t.test('changing trusted store immediately removes customer, pickups and history from previous store',async()=>{
   await actor(2);await q('select club_select_store(\'B\')');await actor(4);assert.equal((await q('select club_store_portal() as r'))[0].r.total,0);assert.equal((await q('select club_store_history() as r'))[0].r.total,0);await assert.rejects(q('select club_lookup_member($1)',[codeA]),/non disponibile/);
   await actor(5);assert.equal((await q('select club_store_portal() as r'))[0].r.total,2);await assert.rejects(q('select club_reverse_purchase($1,\'reso\')',[purchaseId]),/non disponibile/);
  });
  await t.test('consent revocation works and expired document consent cannot grant new marketing',async()=>{
   await actor(2);await assert.rejects(q('select club_update_consents(true,true,\'stale\')'),/aggiornata/);await q('select club_update_consents(false,false,null)');
   const portal=(await q('select club_member_portal() as p'))[0].p;assert.equal(portal.consents.marketing,false);assert.equal(portal.consents.profiling,false);
  });
 }finally{await db.close();}
});

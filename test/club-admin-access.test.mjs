import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
process.env.CLUB_FIXTURE_ONLY='1';
const { createClubFixture }=await import('./club-public-database.test.mjs');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('Club recognizes active Workspace administrators without enrolling or elevating external users',async()=>{
 const db=await createClubFixture();
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const actor=async n=>db.exec(`reset role;set test.auth='${id(n)}';set role authenticated;`);
 try{
  await db.exec(await readFile(new URL('../supabase/migrations/20261017160000_salidischia_club_admin_access.sql',import.meta.url),'utf8'));
  await actor(1);assert.equal((await q('select club_session() as s'))[0].s.role,'admin');assert.equal((await q('select club_admin_purchases() as p'))[0].p.total,0);
  await db.exec('reset role');
  await q("insert into auth.users(id,email,email_confirmed_at) values($1,'admin2@example.test',now())",[id(8)]);await q("update utenti set ruolo_id=$1 where auth_user_id=$2",[id(11),id(8)]);
  await actor(8);assert.equal((await q('select club_session() as s'))[0].s.role,'admin');
  await db.exec('reset role');await q('update utenti set attivo=false where auth_user_id=$1',[id(8)]);await actor(8);await assert.rejects(q('select club_session()'),/account Club/);
  await db.exec('reset role');await q("insert into auth.users(id,email,email_confirmed_at) values($1,'operator@example.test',now())",[id(7)]);await actor(7);await assert.rejects(q('select club_session()'),/account Club/);
  await db.exec('reset role');await q("insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values($1,'customer@example.test',$2,now())",[id(2),{club_app:'salidischia-club',role:'admin',amministratore_workspace:true}]);
  await actor(2);assert.equal((await q('select club_session() as s'))[0].s.role,'onboarding');await assert.rejects(q('select club_admin_purchases()'),/non autorizzato/);
  await db.exec('reset role;set role anon');await assert.rejects(q('select club_admin_purchases()'),/permission denied/);
  await db.exec('reset role');assert.equal((await q('select count(*)::int as n from club_members'))[0].n,0);assert.equal((await q('select count(*)::int as n from club_wallet_movements'))[0].n,0);
 }finally{await db.close();}
});

test('Admin previews share simulated state without accessing real APIs',async()=>{
 const {createPreviewApi}=await import('./fixtures/club-preview-api.js');
 const a=createPreviewApi(),b=createPreviewApi();
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('Preview attempted a real network request');};
 try{
  assert.equal((await a.rpc('club_member_portal')).wallet.available,80);
  const purchase=await a.rpc('club_record_purchase',{member_code:'CLUB-DEMO-001',items:[{product_id:'demo-product',quantity:1,amount:100}],idempotency_key:'purchase-1'});
  assert.equal(purchase.cashback,5);assert.equal((await a.rpc('club_record_purchase',{idempotency_key:'purchase-1'})).id,purchase.id);
  assert.equal((await a.rpc('club_member_portal')).wallet.available,85);
  const request=await a.rpc('club_create_request',{target_reward_id:'demo-reward',target_mode:'products',target_delivery:'home',idempotency_key:'request-1'});
  assert.equal((await a.rpc('club_member_portal')).wallet.available,65.1);
  await a.rpc('club_cancel_request',{target_id:request});assert.equal((await a.rpc('club_member_portal')).wallet.available,85);
  await assert.rejects(a.rpc('club_store_handover',{target_id:'demo-request',pickup_code:'WRONG'}),/non valido/);
  await a.rpc('club_store_handover',{target_id:'demo-request',pickup_code:'DEMO123456'});await a.rpc('club_store_handover',{target_id:'demo-request',pickup_code:'DEMO123456'});
  assert.equal((await a.rpc('club_member_portal')).wallet.used,20);
  await a.rpc('club_select_store',{target_store_code:'DEMO-B'});assert.equal((await a.rpc('club_store_portal')).total,0);await assert.rejects(a.rpc('club_lookup_member',{member_code:'CLUB-DEMO-001'}),/non disponibile/);
  await assert.rejects(a.rpc('club_admin_public_settings',{payload:{}}),/non è disponibile/);
  assert.equal((await b.rpc('club_member_portal')).wallet.available,80);
  const promo=await b.rpc('club_save_store_offer',{payload:{title:'Prezzo dimostrativo',kind:'discount',scope:'product',product_id:'demo-product',discount_mode:'price',sale_price:24,requirements:[]}});
  await b.rpc('club_publish_store_offer',{target_id:promo});assert.equal((await b.rpc('club_catalog_product',{target_id:'demo-product'})).pricing.price,24);assert.equal((await b.rpc('club_catalog_product',{target_id:'demo-product'})).pricing.discount_percent,20);assert.equal((await b.rpc('club_member_portal')).wallet.available,80);
  assert.equal((await a.auth.signInWithPassword({})).preview,true);
 }finally{globalThis.fetch=original;}
});

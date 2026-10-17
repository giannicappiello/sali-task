import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
process.env.CLUB_FIXTURE_ONLY='1';
const { createClubFixture }=await import('./club-public-database.test.mjs');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export async function createStaffFixture() {
 const db=await createClubFixture();
 await db.exec(`
 alter table ruoli add column ambito_dati text default 'propri',add column ambito_team text default 'associazioni';
 alter table utenti add column responsabile_utente_id uuid,add column mexal_agente_id uuid;
 alter table crm_accounts add column reparto_id uuid;
 alter table ordini_clienti_cache add column sync_excluded boolean default false,add column codice_agente_mexal text;
 create table workspace_customer_user_links(user_id uuid,customer_code text);
 create table reparti(id uuid,attivo boolean default true);
 create table utenti_reparti(utente_id uuid,reparto_id uuid);
 create table mexal_agenti(id uuid,codice text,workspace_utente_id uuid,responsabile_utente_id uuid,attivo_mexal boolean default true);
 create table integrazioni_utenti(utente_id uuid,modulo text,enabled boolean,mexal_agente_id uuid);
 create function workspace_commercial_read_all() returns boolean language sql stable as $$select false$$;
 create function normalize_mexal_agent_code(text) returns text language sql immutable as $$select upper(btrim($1))$$;
 update ruoli set ambito_dati='tutti' where amministratore_workspace;
 `);
 const source=await readFile(new URL('../supabase/migrations/20260912230000_role_relationship_data_scope.sql',import.meta.url),'utf8');
 const install=async(text,name)=>{const start=text.indexOf('create or replace function public.'+name+'(');assert.ok(start>=0);const end=text.indexOf('$$;',text.indexOf('as $$',start))+3;await db.exec(text.slice(start,end));};
 await install(source,'workspace_data_scope');
 const departments=await readFile(new URL('../supabase/migrations/20260912170000_department_commercial_data_scope.sql',import.meta.url),'utf8');await install(departments,'visible_mexal_agent_ids');
 await install(await readFile(new URL('../supabase/migrations/20260727120000_organizational_visibility.sql',import.meta.url),'utf8'),'visible_mexal_agent_codes');
 await install(source,'crm_row_visible');await install(source,'crm_visible_canonical_customer_codes');
 for(const name of ['20261017160000_salidischia_club_admin_access.sql','20261017170000_salidischia_club_staff_scope.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(`
 insert into ruoli(id,nome,amministratore_workspace,ambito_dati,ambito_team) values
 ('${id(21)}','Agente di Commercio',false,'propri','associazioni'),('${id(22)}','Beauty Consultant',false,'team','associazioni'),('${id(23)}','Responsabile reparto',false,'team','gerarchia'),('${id(24)}','Backoffice',false,'tutti','reparti');
 insert into auth.users(id,email,email_confirmed_at) values('${id(10)}','agent-a@example.test',now()),('${id(20)}','agent-b@example.test',now()),('${id(30)}','beauty@example.test',now()),('${id(40)}','manager@example.test',now()),('${id(60)}','backoffice@example.test',now());
 update utenti set ruolo_id='${id(21)}',responsabile_utente_id='${id(40)}' where id='${id(10)}';update utenti set ruolo_id='${id(21)}' where id='${id(20)}';update utenti set ruolo_id='${id(22)}' where id='${id(30)}';update utenti set ruolo_id='${id(23)}' where id='${id(40)}';update utenti set ruolo_id='${id(24)}' where id='${id(60)}';
 insert into mexal_agenti(id,codice,workspace_utente_id,responsabile_utente_id) values('${id(101)}','AG-A','${id(10)}','${id(40)}'),('${id(102)}','AG-B','${id(20)}',null);
 insert into integrazioni_utenti values('${id(30)}','report_giornate',true,'${id(101)}');
 update ordini_clienti_cache set codice_agente_mexal=case when codice_cliente='A' then 'AG-A' else 'AG-B' end;
 insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values('${id(2)}','customer-a@example.test','{"club_app":"salidischia-club"}',now()),('${id(3)}','customer-b@example.test','{"club_app":"salidischia-club"}',now());
 insert into crm_accounts(id,tipo,nome,responsabile_id) values('${id(201)}','online','Cliente A','${id(1)}'),('${id(202)}','online','Cliente B','${id(1)}');
 insert into club_members(id,auth_user_id,crm_account_id,trusted_store_code) values('${id(301)}','${id(2)}','${id(201)}','A'),('${id(302)}','${id(3)}','${id(202)}','B');
 insert into club_configurations(id,name,status,cashback_percent,reimbursement_modes,delivery_methods,created_by,effective_at,published_at) values('${id(401)}','Programma','published',5,array['products'],array['pickup'],'${id(1)}','2020-01-01',now());
 insert into club_rewards(id,kind,product_id,name,budget_required,stock,delivery_methods) values('${id(402)}','products','${id(50)}','Premio',5,20,array['pickup']);
 insert into club_purchases(id,member_id,store_code,configuration_id,amount,cashback,idempotency_key) values('${id(501)}','${id(301)}','A','${id(401)}',100,5,'${id(501)}'),('${id(502)}','${id(302)}','B','${id(401)}',200,10,'${id(502)}');
 insert into club_wallet_movements(member_id,purchase_id,kind,available_delta,reason) values('${id(301)}','${id(501)}','earn',5,'Test A'),('${id(302)}','${id(502)}','earn',10,'Test B');
 set test.auth='${id(2)}';set role authenticated;
 select club_create_request('${id(402)}','products',null,'pickup','{}','${id(601)}');
 reset role;set test.auth='${id(3)}';set role authenticated;
 select club_create_request('${id(402)}','products',null,'pickup','{}','${id(602)}');reset role;
 `);
 return db;
}

if (!process.env.CLUB_STAFF_FIXTURE_ONLY) test('Club staff uses actual Workspace relationship, hierarchy and CRM row visibility functions',async()=>{
 const db=await createStaffFixture();const q=async(sql,args=[])=>(await db.query(sql,args)).rows;const actor=async n=>db.exec(`reset role;set test.auth='${id(n)}';set role authenticated;`);
 try{
  for(const n of [10,30,40]){
   await actor(n);const session=(await q('select club_session() as s'))[0].s;assert.equal(session.role,'staff');assert.ok(session.workspace_role);
   const members=(await q('select club_admin_members() as m'))[0].m;assert.equal(members.total,1);assert.equal(members.rows[0].customer_name,'Cliente A');
   assert.equal((await q("select club_admin_requests('') as r"))[0].r.total,1);assert.equal((await q('select club_admin_purchases() as p'))[0].p.total,1);
   const dash=(await q("select club_admin_dashboard('2020-01-01','2099-01-01') as d"))[0].d;assert.equal(dash.members,1);assert.equal(Number(dash.sales),100);assert.equal(dash.pending_requests,1);
   assert.deepEqual((await q('select club_admin_stores() as s'))[0].s.stores.map(s=>s.store_code),['A']);
   assert.equal((await q('select club_admin_movements($1) as m',[id(302)]))[0].m.total,0);
   await assert.rejects(db.query('select * from club_scoped_members'),/permission denied/);
  }
  await actor(20);assert.equal((await q('select club_admin_members() as m'))[0].m.rows[0].customer_name,'Cliente B');
  await db.exec('reset role');const foreignRequest=(await q('select id from club_requests where member_id=$1',[id(302)]))[0].id;await actor(10);
  await assert.rejects(q("select club_transition_request($1,'approved')",[foreignRequest]),/ambito Workspace/);await assert.rejects(q("select club_admin_enable_store('B',false)"),/ambito Workspace/);await assert.rejects(q("select club_admin_invite_store('B','operator@example.test')"),/ambito Workspace/);
  for(const n of [1,60]){await actor(n);assert.equal((await q('select club_admin_members() as m'))[0].m.total,2);}
  await db.exec('reset role');await q("update mexal_agenti set workspace_utente_id=$1 where codice='AG-A'",[id(20)]);await q('update utenti set responsabile_utente_id=null where id=$1',[id(10)]);await actor(10);assert.equal((await q('select club_admin_members() as m'))[0].m.total,0);
  await db.exec('reset role');await db.exec("create or replace function workspace_screen_level_for_user(uuid,text) returns text language sql stable as $$select case when $1='"+id(10)+"' then case when $2 in ('crm.online.club.dashboard','crm.online.club.clienti') then 'lettura' else 'nessuno' end else 'amministrazione' end$$;");await actor(10);const permissions=(await q('select club_session() as s'))[0].s.permissions;assert.equal(permissions.clienti,'lettura');assert.equal(permissions.richieste,'nessuno');await assert.rejects(q('select club_admin_requests()'),/non autorizzato/);
  await actor(2);assert.equal((await q('select club_session() as s'))[0].s.role,'member');await assert.rejects(q('select club_admin_members()'),/non autorizzato/);
 }finally{await db.close();}
});

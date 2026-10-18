import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
process.env.CLUB_FIXTURE_ONLY='1';
const {createClubFixture}=await import('./club-public-database.test.mjs');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('Club enrollment requires separate names, verified email and an explicit profiling choice',async t=>{
 const db=await createClubFixture(),q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const actor=async who=>db.exec(`reset role;set test.auth='${who?id(who):''}';set role ${who?'authenticated':'anon'};`);
 let info;
 const enroll=async changes=>{const a={first_name:'Maria',last_name:'De Luca',email_address:'member@example.test',phone_number:'',accept_program:true,profiling:true,expected_terms_url:info.terms_url,expected_privacy_url:info.privacy_url,...changes};return q('select club_enroll_member('+Object.keys(a).map((key,i)=>`${key}=>$${i+1}`).join(',')+') as id',Object.values(a));};
 try{
  await db.exec(await readFile(new URL('../supabase/migrations/20261018170000_salidischia_club_enrollment_fields.sql',import.meta.url),'utf8'));
  await db.exec(`reset role;insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at)values('${id(2)}','member@example.test','{"club_app":"salidischia-club","first_name":"Maria","last_name":"De Luca"}',now()),('${id(3)}','unverified@example.test','{"club_app":"salidischia-club"}',null);`);
  await actor(1);await q('select club_admin_public_settings($1)',[{crm_owner_id:id(1)}]);
  for(const kind of ['program','privacy']){const doc=(await q('select club_save_document($1,$2,$3) as id',[kind,'Documento '+kind,'Testo di prova sufficientemente lungo per il documento del Club.']))[0].id;await db.exec('reset role');const stamp=(await q('select updated_at from club_documents where id=$1',[doc]))[0].updated_at;await actor(1);await q('select club_publish_document($1,$2)',[doc,stamp]);}
  info=(await q('select club_public_info() as value'))[0].value;
  await t.test('only the signed-in verified identity supplies its email and names',async()=>{
   await actor(null);await assert.rejects(q('select club_enrollment_identity()'),/permission denied/);
   await actor(3);await assert.rejects(q('select club_enrollment_identity()'),/conferma|email/i);
   await actor(2);await db.exec("set request.path='/rpc/club_enrollment_identity'");await q('select club_api_boundary()');const identity=(await q('select club_enrollment_identity() as value'))[0].value;assert.deepEqual(identity,{email:'member@example.test',first_name:'Maria',last_name:'De Luca'});
  });
  await t.test('missing names/email, another email, false/null profiling and unaccepted terms are rejected',async()=>{
   for(const changes of [{first_name:''},{first_name:'  '},{last_name:''},{email_address:''},{email_address:null},{email_address:'other@example.test'},{profiling:false},{profiling:null},{accept_program:false}])await assert.rejects(enroll(changes),/nome|email|consenso|condizioni/i);
   await assert.rejects(enroll({expected_terms_url:'outdated'}),/documenti/);
   await assert.rejects(q('select club_enroll_member($1,$2,true,false,true,$3,$4)',['Old API','',info.terms_url,info.privacy_url]),/does not exist/);
   await assert.rejects(q('select club_enroll_member_v1($1,$2,true,false,true,$3,$4)',['Bypass','',info.terms_url,info.privacy_url]),/permission denied/);
  });
  await t.test('enrollment stores separate names, keeps marketing denied, records profiling and is idempotent',async()=>{
   const member=(await enroll({}))[0].id;assert.equal((await enroll({}))[0].id,member);
   await db.exec('reset role');const row=(await q('select m.first_name,m.last_name,a.nome,a.email,a.metadati from club_members m join crm_accounts a on a.id=m.crm_account_id where m.id=$1',[member]))[0];assert.equal(row.first_name,'Maria');assert.equal(row.last_name,'De Luca');assert.equal(row.nome,'Maria De Luca');assert.equal(row.email,'member@example.test');assert.equal(row.metadati.club_last_name,'De Luca');
   const consents=Object.fromEntries((await q('select purpose,granted from club_consents where member_id=$1',[member])).map(c=>[c.purpose,c.granted]));assert.deepEqual(consents,{program:true,marketing:false,profiling:true});assert.equal((await q('select count(*)::int as count from crm_accounts'))[0].count,1);
  });
 }finally{await db.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
process.env.CLUB_FIXTURE_ONLY='1';
const {createClubFixture}=await import('./club-public-database.test.mjs');
const admin='10000000-0000-4000-8000-000000000001';
test('registration opens only after a real CRM owner and both published in-app documents exist',async()=>{
 const db=await createClubFixture(),q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const actor=()=>db.exec(`reset role;set test.auth='${admin}';set role authenticated;`);
 const info=async()=>(await q('select club_public_info() as value'))[0].value;
 try{
  assert.equal((await info()).registration_available,false);
  await actor();await q('select club_admin_public_settings($1)',[{crm_owner_id:admin,support_email:'info@salidischia.it'}]);assert.equal((await info()).registration_available,false);
  for(const kind of ['program','privacy']){
   const id=(await q('select club_save_document($1,$2,$3) as id',[kind,'Documento '+kind,'# Documento del Club\n\nContenuto completo della versione usata per questa verifica.']))[0].id;
   await db.exec('reset role');const stamp=(await q('select updated_at from club_documents where id=$1',[id]))[0].updated_at;await actor();await q('select club_publish_document($1,$2)',[id,stamp]);
   assert.equal((await info()).registration_available,kind==='privacy');
  }
  await db.exec('reset role;set role anon');const current=await info();assert.equal(current.registration_available,true);assert.equal(current.support_email,'info@salidischia.it');
  for(const[kind,path]of[['program',current.terms_url],['privacy',current.privacy_url]]){assert.ok(path.startsWith('/regolamento?documento='+kind+'&version='));const version=new URL('https://club.salidischia.it'+path).searchParams.get('version');const document=(await q('select club_public_document($1,$2) as value',[kind,version]))[0].value;assert.equal(document.kind,kind);assert.ok(document.published_at);assert.ok(!document.body.includes('[['));}
 }finally{await db.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
process.env.CLUB_STAFF_FIXTURE_ONLY='1';
const { createStaffFixture }=await import('./club-staff-scope.test.mjs');
export const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export async function createContentFixture() {
 const db=await createStaffFixture();
 await db.exec(`reset role;alter table prodotti add column categoria_mexal text,add column brand_mexal text,add column linea_mexal text,add column immagine_catalogo_url text,add column ean text,add column costo_ultimo numeric;
 create table sezioni_documentali(id uuid primary key,nome text,attiva boolean default true);
 create table documenti_workspace(id uuid primary key,percorso text,nome_file text,titolo text,mime_group text,attivo boolean default true,sezione_id uuid,prodotto_id uuid,categorie_prodotto text[],brand_prodotti text[],linee_prodotto text[]);
 insert into documenti_workspace(id,percorso,nome_file,titolo,mime_group,prodotto_id) values('${id(701)}','/catalog/photo.jpg','photo.jpg','Foto prodotto','immagine','${id(50)}'),('${id(702)}','/catalog/manual.pdf','manual.pdf','Scheda tecnica','pdf','${id(50)}'),('${id(703)}','/private/internal.pdf','internal.pdf','Documento interno','pdf',null),('${id(704)}','/catalog/video.mp4','video.mp4','Video rituale','video','${id(50)}');
 update prodotti set ean='987654321',costo_ultimo=99 where id='${id(50)}';
 create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 `);
 await db.exec(await readFile(new URL('../supabase/migrations/20261018100000_salidischia_club_catalog_content.sql',import.meta.url),'utf8'));
 return db;
}
if (!process.env.CLUB_CONTENT_FIXTURE_ONLY) test('Club catalogue and editorial publication use existing Workspace permissions and selected media',async t=>{
 const db=await createContentFixture();const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const actor=async n=>db.exec(`reset role;set request.jwt.claim.sub='${n?id(n):''}';set test.auth='${n?id(n):''}';set role ${n?'authenticated':'anon'};`);
 const rpc=async(name,args=[]) => (await q(name,args))[0].value;
 let stamp,post,postStamp;
 try {
  await t.test('anonymous catalogue is limited to eligible fields and supports partial, code, EAN and descendant search',async()=>{
   await actor(null);const cats=await rpc('select club_catalog_categories() as value');assert.equal(cats.length,41);
   const result=await rpc('select club_catalog_products() as value');assert.equal(result.total,1);assert.equal(result.rows[0].code,'IT0492');assert.equal(result.rows[0].costo_ultimo,undefined);assert.deepEqual(result.rows[0].media,[]);
   assert.equal((await rpc("select club_catalog_products('987654') as value")).total,1);
   assert.equal((await rpc("select club_catalog_products('IT04') as value")).total,1);
   await assert.rejects(q('select * from club_catalog_products'),/permission denied/);
   await assert.rejects(q('select club_editor_data(\'products\')'),/permission denied|non autorizzato/);
  });
  await t.test('editor selects categories and existing documents, with optimistic concurrency',async()=>{
   await actor(1);const entry=await rpc("select club_editor_entry('products',$1) as value",[id(50)]);stamp=entry.updated_at;
   const payload={name:'Crema rituale viso',description:'Idratazione quotidiana',visible:true,category_ids:[881],document_ids:[id(701),id(702),id(704)],cover_id:id(701)};
   await q('select club_save_catalog_product($1,$2,$3)',[id(50),payload,stamp]);
   await assert.rejects(q('select club_save_catalog_product($1,$2,$3)',[id(50),payload,stamp]),/cambiato/);
   await actor(null);assert.equal((await rpc("select club_catalog_products('crema ritual',72) as value")).total,1);
   assert.equal((await rpc("select club_catalog_products('skin ritual') as value")).total,1);
   const product=await rpc('select club_catalog_product($1) as value',[id(50)]);assert.equal(product.media.length,3);assert.equal(product.media.some(m=>m.id===id(703)),false);assert.equal(product.media[0].cover,true);
   await db.exec('reset role');assert.equal((await q('select nome from prodotti where id=$1',[id(50)]))[0].nome,'Crema Sali di Ischia');
  });
  await t.test('drafts, scheduling, audiences, immutable publication and archive',async()=>{
   await actor(1);post=await rpc('select club_save_post($1) as value',[{kind:'offer',title:'Rituale di primavera',summary:'Novità dal Club',body:'Testo pubblico completo.',audience:'members',document_ids:[id(703)],product_ids:[id(50)],featured:true}]);
   postStamp=(await rpc("select club_editor_entry('posts',$1) as value",[post])).updated_at;
   await actor(2);assert.equal((await rpc('select club_feed() as value')).total,0);await assert.rejects(q("select club_editor_media()"),/non autorizzata/);
   await actor(1);await q('select club_publish_post($1,$2)',[post,postStamp]);
   await actor(null);assert.equal((await rpc('select club_feed() as value')).total,0);assert.equal(await rpc('select club_post($1) as value',[post]),null);
   await actor(2);assert.equal((await rpc("select club_feed('highlights') as value")).total,1);const detail=await rpc('select club_post($1) as value',[post]);assert.equal(detail.products.length,1);assert.equal(detail.media[0].id,id(703));
   await actor(1);const published=await rpc("select club_editor_entry('posts',$1) as value",[post]);await assert.rejects(q('select club_save_post($1,$2,$3)',[{kind:'news',title:'Overwrite',body:'No'},post,published.updated_at]),/nuova bozza/);
   const future=await rpc('select club_save_post($1) as value',[{kind:'news',title:'Futura',body:'Futura.',starts_at:'2099-01-01'}]);let futureStamp=(await rpc("select club_editor_entry('posts',$1) as value",[future])).updated_at;await q('select club_publish_post($1,$2)',[future,futureStamp]);
   assert.equal((await rpc('select club_feed() as value')).total,1);
   await q('select club_publish_post($1,$2,true)',[post,published.updated_at]);await actor(2);assert.equal((await rpc('select club_feed() as value')).total,0);
  });
  await t.test('media resolver is service only and denies documents absent from a visible publication',async()=>{
   await actor(2);await assert.rejects(q('select club_media_paths($1,$2)',[[id(701)],id(2)]),/permission denied/);
   await db.exec('reset role');let urls=await rpc('select club_media_paths($1,null) as value',[[id(701),id(702),id(703),id(704)]]);assert.equal(Object.keys(urls).length,3);assert.equal(urls[id(703)],undefined);
   await q('update club_catalog_products set visible=false where product_id=$1',[id(50)]);urls=await rpc('select club_media_paths($1,null) as value',[[id(701)]]);assert.deepEqual(urls,{});
  });
  await t.test('store and staff audiences, expired posts and signed materials remain separated',async()=>{
   await db.exec(`reset role;insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values('${id(4)}','store@example.test','{"club_app":"salidischia-club"}',now());insert into club_stores(store_code) values('A') on conflict do nothing;insert into club_store_users(auth_user_id,store_code) values('${id(4)}','A');`);
   await actor(1);
   for(const audience of ['all','members','stores','staff']){
    const value=await rpc('select club_save_post($1) as value',[{kind:'communication',title:'Avviso '+audience,body:'Destinatari '+audience,audience,document_ids:audience==='stores'?[id(703)]:[]}]);
    const version=await rpc("select club_editor_entry('posts',$1) as value",[value]);await q('select club_publish_post($1,$2)',[value,version.updated_at]);
   }
   const expired=await rpc('select club_save_post($1) as value',[{kind:'offer',title:'Scaduta',body:'Scaduta.',starts_at:'2020-01-01',ends_at:'2021-01-01'}]);const version=await rpc("select club_editor_entry('posts',$1) as value",[expired]);await q('select club_publish_post($1,$2)',[expired,version.updated_at]);
   for(const [who,expected]of [[null,['all']],[2,['all','members']],[4,['all','stores']],[10,['all','members','staff','stores']]]){
    await actor(who);const feed=await rpc('select club_feed() as value');assert.deepEqual(feed.rows.map(row=>row.title.slice(7)).sort(),expected);
   }
   await db.exec(`reset role;create or replace function workspace_screen_level_for_user(uuid,text) returns text language sql stable as $$select case when $1='${id(10)}' then case when $2='crm.online.club.dashboard' then 'lettura' else 'nessuno' end else 'amministrazione' end$$;`);
   await actor(10);assert.equal((await rpc('select club_feed() as value')).total,2);
   for(const [viewer,count]of [[null,0],[2,0],[4,1]]){await db.exec('reset role');assert.equal(Object.keys(await rpc('select club_media_paths($1,$2) as value',[[id(703)],viewer?id(viewer):null])).length,count);}
  });
  await t.test('Workspace screen permissions restrict editing and publication separately',async()=>{
   await db.exec(`reset role;create or replace function workspace_screen_level_for_user(uuid,text) returns text language sql stable as $$select case when $1='${id(10)}' then case when $2='crm.online.club.contenuti' then 'scrittura' else 'nessuno' end else 'amministrazione' end$$;`);
   await actor(10);const session=await rpc('select club_session() as value');assert.equal(session.permissions.contenuti,'scrittura');assert.equal(session.permissions.catalogo,'nessuno');
   await assert.rejects(q("select club_editor_data('products')"),/non autorizzato/);assert.equal((await rpc('select club_editor_products() as value')).total,1);
   const draft=await rpc('select club_save_post($1) as value',[{kind:'communication',title:'Bozza staff',body:'Testo.'}]);const draftStamp=(await rpc("select club_editor_entry('posts',$1) as value",[draft])).updated_at;
   await assert.rejects(q('select club_publish_post($1,$2)',[draft,draftStamp]),/non autorizzato/);
   await actor(2);await db.exec("set request.path='/rpc/club_feed'");await q('select club_api_boundary()');await db.exec("set request.path='/rpc/club_editor_data'");await assert.rejects(q('select club_api_boundary()'),/riservato/);
  });
 } finally {await db.close();}
});

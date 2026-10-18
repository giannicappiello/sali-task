import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
process.env.CLUB_CONTENT_FIXTURE_ONLY='1';
const {createContentFixture,id}=await import('./club-catalog-content.test.mjs');
test('PDF catalogue order, CRM reordering and Workspace document parity',async t=>{
 const db=await createContentFixture(),q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(sql,args=[])=>(await q(sql,args))[0].value;
 const actor=async who=>db.exec(`reset role;set request.jwt.claim.sub='${who?id(who):''}';set test.auth='${who?id(who):''}';set role ${who?'authenticated':'anon'};`);
 try{
  await db.exec(`reset role;alter table prodotti add column prezzo_listino numeric;update prodotti set prezzo_listino=100 where id='${id(50)}';insert into prodotti(id,nome,codice_mexal,prezzo_listino,categoria_mexal,brand_mexal,linea_mexal) values('${id(51)}','B-Phase','IT0208',30,' Cleanse ',' SALI ',' Face '),('${id(52)}','Mousse','IT0569',20,null,null,null),('${id(53)}','Extra','IT-EXTRA',15,null,null,null),('${id(54)}','Hair Mist','IT0556',25,null,null,null);insert into club_catalog_products(product_id,display_name)select id,nome from prodotti where id in('${id(51)}','${id(52)}','${id(53)}','${id(54)}');`);
  for(const migration of ['20261018110000_salidischia_club_store_offers.sql','20261018120000_salidischia_club_pdf_order_workspace_media.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
  await t.test('PDF sequence, primary sections, multi-section products and legacy categories coexist',async()=>{
   await actor(null);const all=await rpc('select club_catalog_products() as value');assert.deepEqual(all.rows.map(p=>p.code),['IT0208','IT0569','IT0492','IT0556','IT-EXTRA']);
   assert.equal(all.rows[0].catalog_group,'viso-cleanse');assert.equal(all.rows[0].pricing.list_price,30);
   assert.deepEqual((await rpc("select club_browse_catalog('',null,0,'viso-cleanse') as value")).rows.map(p=>p.code),['IT0208','IT0569']);
   for(const section of ['gesti-capelli','solari-doposole'])assert.ok((await rpc('select club_browse_catalog(\'\',null,0,$1) as value',[section])).rows.some(p=>p.code==='IT0556'));
   assert.equal((await rpc("select club_browse_catalog('',null,0,'altri') as value")).total,1);
   assert.equal((await rpc('select club_catalog_categories() as value')).length,41);
   await assert.rejects(q("select club_browse_catalog('',null,0,'invalid')"),/non valida/);
  });
  await t.test('staff saves exact global order, revision conflicts, invalid sets and reset',async()=>{
   await actor(2);await assert.rejects(q('select club_catalog_order()'),/non autorizzato/);
   await actor(1);let state=await rpc('select club_catalog_order() as value');const ids=state.rows.map(p=>p.id).reverse();
   await assert.rejects(q('select club_set_catalog_order($1,$2)',[[...ids,ids[0]],state.revision]),/incompleto/);
   await assert.rejects(q('select club_set_catalog_order($1,$2)',[ids.slice(1),state.revision]),/incompleto/);
   await q('select club_set_catalog_order($1,$2)',[ids,state.revision]);
   await assert.rejects(q('select club_set_catalog_order($1,$2)',[ids,state.revision]),/ordine è cambiato/);
   await actor(null);assert.deepEqual((await rpc('select club_catalog_products() as value')).rows.map(p=>p.id),ids);
   assert.deepEqual((await rpc("select club_browse_catalog('',null,0,'viso') as value")).rows.map(p=>p.code),['IT0492','IT0569','IT0208']);
   await actor(1);state=await rpc('select club_catalog_order() as value');await q('select club_set_catalog_order($1,$2,true)',[[],state.revision]);
   await actor(null);assert.equal((await rpc('select club_catalog_products() as value')).rows[0].code,'IT0208');
   await assert.rejects(q('select * from club_catalog_order_state'),/permission denied/);
  });
  await t.test('dynamic product/category/brand/line associations, deduplication, and authorization of NAS paths',async()=>{
   await db.exec(`reset role;insert into sezioni_documentali(id,nome)values('${id(800)}','Schede prodotto');
    update documenti_workspace set sezione_id='${id(800)}' where id='${id(702)}';
    insert into documenti_workspace(id,percorso,titolo,mime_group,sezione_id,categorie_prodotto,brand_prodotti,linee_prodotto,attivo)values
    ('${id(710)}','/catalog/category.pdf','Categoria','pdf','${id(800)}',array['cleanse'],null,null,true),
    ('${id(711)}','/catalog/brand.pdf','Brand','pdf','${id(800)}',null,array['sali'],null,true),
    ('${id(712)}','/catalog/line.pdf','Linea','pdf','${id(800)}',null,null,array['face'],true),
    ('${id(713)}','/private/inactive.pdf','Inattivo','pdf','${id(800)}',array['cleanse'],null,null,false),
    ('${id(714)}','/private/sectionless.pdf','Senza sezione','pdf',null,array['cleanse'],null,null,true),
    ('${id(715)}','/private/empty.pdf','Vuoto','pdf','${id(800)}',array[''],null,null,true);
    insert into club_catalog_product_media values('${id(50)}','${id(702)}',0,false);`);
   await actor(null);const direct=await rpc('select club_catalog_product($1) as value',[id(50)]);assert.equal(direct.media.length,1);assert.equal(direct.media[0].section,'Schede prodotto');
   let product=await rpc('select club_catalog_product($1) as value',[id(51)]);assert.deepEqual(product.media.map(d=>d.title).sort(),['Brand','Categoria','Linea']);assert.equal(JSON.stringify(product).includes('/catalog/'),false);
   const docs=[702,703,710,711,712,713,714,715].map(id);
   await assert.rejects(q('select club_media_paths($1,null)',[docs]),/permission denied/);
   await db.exec('reset role');let paths=await rpc('select club_media_paths($1,null) as value',[docs]);assert.deepEqual(Object.keys(paths).sort(),[702,710,711,712].map(id).sort());
   await q('update club_catalog_products set visible=false where product_id=$1',[id(51)]);paths=await rpc('select club_media_paths($1,null) as value',[docs]);assert.deepEqual(Object.keys(paths),[id(702)]);
   await q('update club_catalog_products set visible=true where product_id=$1',[id(51)]);await q('update documenti_workspace set categorie_prodotto=\'{}\' where id=$1',[id(710)]);await actor(null);product=await rpc('select club_catalog_product($1) as value',[id(51)]);assert.equal(product.media.length,2);
  });
  await t.test('technical sheet backfill matches exact filenames, preserves explicit links and rejects prefix-only matches',async()=>{
   await db.exec(`reset role;insert into sezioni_documentali(id,nome)values('${id(801)}','Schede tecniche');insert into documenti_workspace(id,nome_file,titolo,mime_group,sezione_id,prodotto_id)values('${id(720)}','IT0569.pdf','Scheda mousse','pdf','${id(801)}',null),('${id(721)}','IT05690.pdf','Codice diverso','pdf','${id(801)}',null),('${id(722)}','IT0208.pdf','Collegamento esplicito','pdf','${id(801)}','${id(50)}');alter table documenti_workspace add column prodotto text,add column aggiornato_il timestamptz;`);
   await db.exec(await readFile(new URL('../supabase/migrations/20261018140000_salidischia_club_document_sku_links.sql',import.meta.url),'utf8'));
   const rows=await q('select id,prodotto_id from documenti_workspace where id=any($1)',[[720,721,722].map(id)]);
   assert.equal(rows.find(d=>d.id===id(720)).prodotto_id,id(52));assert.equal(rows.find(d=>d.id===id(721)).prodotto_id,null);assert.equal(rows.find(d=>d.id===id(722)).prodotto_id,id(50));
   await actor(null);assert.ok((await rpc('select club_catalog_product($1) as value',[id(52)])).media.some(d=>d.id===id(720)));
  });
  await t.test('read-only staff cannot save order; external Club boundary denies CRM methods',async()=>{
   await db.exec(`reset role;create or replace function workspace_screen_level_for_user(uuid,text) returns text language sql stable as $$select case when $1='${id(10)}' then 'lettura' else 'amministrazione' end$$;`);
   await actor(10);assert.equal((await rpc('select club_catalog_order() as value')).rows.length,5);await assert.rejects(q('select club_set_catalog_order($1,2)',[[]]),/non autorizzato/);
   await actor(2);await db.exec("set request.path='/rpc/club_set_catalog_order';");await assert.rejects(q('select club_api_boundary()'),/riservato alle API Club/);
  });
 }finally{await db.close();}
});

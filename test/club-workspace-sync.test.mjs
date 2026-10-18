import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
process.env.CLUB_CONTENT_FIXTURE_ONLY='1';
const {createContentFixture,id}=await import('./club-catalog-content.test.mjs');

test('Workspace catalogue sync is authorized, repeatable and preserves Club editorial choices',async()=>{
 const db=await createContentFixture();
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const actor=async who=>db.exec(`reset role;set request.jwt.claim.sub='${who?id(who):''}';set test.auth='${who?id(who):''}';set role ${who?'authenticated':'anon'};`);
 try {
  await db.exec(`reset role;alter table prodotti add column prezzo_listino numeric;alter table documenti_workspace add column prodotto text,add column aggiornato_il timestamptz;
   insert into prodotti(id,nome,codice_mexal,categoria_mexal,brand_mexal,linea_mexal)values('${id(51)}','Nuovo prodotto','IT-NEW',null,null,null);
   insert into sezioni_documentali(id,nome)values('${id(800)}','Schede tecniche');
   insert into documenti_workspace(id,nome_file,titolo,mime_group,sezione_id)values('${id(801)}','IT-NEW.pdf','Nuova scheda','pdf','${id(800)}'),('${id(802)}','IT-NEW-extra.pdf','Non esatto','pdf','${id(800)}');
   update documenti_workspace set sezione_id='${id(800)}' where id in('${id(701)}','${id(702)}');
   update club_catalog_products set display_name='Nome editoriale',description='Descrizione manuale',visible=false where product_id='${id(50)}';
   insert into club_catalog_product_media(product_id,document_id,is_cover)values('${id(50)}','${id(701)}',true);`);
  for(const file of ['20261018110000_salidischia_club_store_offers.sql','20261018120000_salidischia_club_pdf_order_workspace_media.sql','20261018220000_salidischia_club_workspace_sync.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  await actor(null);await assert.rejects(q('select club_sync_workspace_catalog()'),/permission denied|non autorizzato/);
  await actor(2);await assert.rejects(q('select club_sync_workspace_catalog()'),/non autorizzato/);
  await actor(1);const first=(await q('select club_sync_workspace_catalog() as result'))[0].result;
  assert.equal(first.added_products,1);assert.equal(first.linked_documents,1);assert.equal(first.products,1);assert.equal(first.documents,1);
  const second=(await q('select club_sync_workspace_catalog() as result'))[0].result;
  assert.equal(second.added_products,0);assert.equal(second.linked_documents,0);
  await db.exec('reset role');
  const editorial=(await q('select display_name,description,visible from club_catalog_products where product_id=$1',[id(50)]))[0];
  assert.deepEqual(editorial,{display_name:'Nome editoriale',description:'Descrizione manuale',visible:false});
  assert.equal((await q('select document_id from club_catalog_product_media where product_id=$1 and is_cover',[id(50)]))[0].document_id,id(701));
  assert.equal((await q('select prodotto_id from documenti_workspace where id=$1',[id(801)]))[0].prodotto_id,id(51));
  assert.equal((await q('select prodotto_id from documenti_workspace where id=$1',[id(802)]))[0].prodotto_id,null);
  assert.equal((await q("select count(*)::integer as total from club_audit where event='WORKSPACE_CATALOG_SYNCED'"))[0].total,2);
  await db.exec(`update prodotti set immagine_catalogo_url='https://example.test/new-image.jpg' where id='${id(51)}';update documenti_workspace set titolo='Scheda aggiornata' where id='${id(801)}'`);
  await actor(null);const product=(await q('select club_catalog_product($1) as result',[id(51)]))[0].result;
  assert.equal(product.image_url,'https://example.test/new-image.jpg');assert.equal(product.media[0].title,'Scheda aggiornata');
 } finally {await db.close();}
});
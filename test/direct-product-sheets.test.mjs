import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { defaultLayout, SHEET_FIELDS, alignBoxes, boundBox, generationContent, sheetHtml, sheetStatus, sheetValues } from '../shared/directProductSheet.js';
import { publishSheetToChannel } from '../server/direct-sheet-publishers.js';
import { translateSheetContent, createSheetHandler } from '../server/direct-product-sheets.js';
import { createGeneratedSheetHandler, signSheetArchive } from '../hosting/document-gateway/generated-sheets.mjs';

const content = Object.fromEntries(SHEET_FIELDS.map(f => [f.key, f.key === 'inci' ? 'Aqua, Glycerin, Parfum.' : `Testo ${f.label}.`]));
const productId = '10000000-0000-4000-8000-000000000050';

test('Shared sheet states, master data, escaped channel content and geometry', () => {
  assert.equal(sheetStatus(null).label, 'Da compilare'); assert.equal(sheetStatus({ content:{ description:'x' } }).count, 1); assert.equal(sheetStatus({ content }).label,'Completa');
  assert.equal(sheetValues({ codice_mexal:'IT0001',nome:'Nome',ean:'01234',formato:'50 ml' }).format,'50 ml');
  assert.match(sheetHtml({ ...content,description:'<script>\n&test' }),/&lt;script&gt;<br>&amp;test/);
  const boxes = [{ id:'a',page:'p',x:10,y:10,width:10,height:10 },{ id:'b',page:'p',x:50,y:30,width:20,height:10 },{ id:'c',page:'p',x:80,y:50,width:10,height:10 }];
  assert.deepEqual(alignBoxes(boxes,['a','b'],'left').map(b=>b.x),[10,10,80]);
  assert.equal(alignBoxes(boxes,['a'],'center')[0].x,45);
  assert.deepEqual(alignBoxes(boxes,['a','b','c'],'distribute-x').map(b=>b.x),[10,40,80]);
  assert.deepEqual(boundBox({...boxes[0],x:99,y:-4}),{...boxes[0],x:90,y:0});
  assert.throws(()=>generationContent({revision:2,content},[{language:'ENG',source_revision:1,reviewed:true,content}],'ENG'),/Traduzione/);
  assert.deepEqual(generationContent({revision:2,content},[{language:'ENG',source_revision:2,reviewed:true,content}],'ENG'),content);
});

test('Woo writes only content to a unique exact SKU; Amazon acceptance differs from live publication',async()=>{
  const calls=[]; const woo={provider_code:'woocommerce',configurazione:{site_url:'https://example.test'}};
  const fetcher=async(url,options)=>{calls.push({url,options});return {ok:true,data:calls.length===1?[{id:42,sku:'EXACT'}]:{id:42}};};
  const sent=await publishSheetToChannel({connection:woo,mapping:{external_sku:'EXACT'},content,secrets:{consumer_key:'private',consumer_secret:'private'},fetcher});
  assert.equal(sent.status,'sent'); assert.deepEqual(Object.keys(JSON.parse(calls[1].options.body)).sort(),['description','short_description']);
  await assert.rejects(publishSheetToChannel({connection:woo,mapping:{external_sku:'EXACT'},content,secrets:{consumer_key:'x',consumer_secret:'y'},fetcher:async()=>({ok:true,data:[{id:42,sku:'OTHER'}]})}),/univoco/);
  const amazonCalls=[];
  const amazonFetcher=async(url,options)=>{amazonCalls.push({url,options});return {ok:true,data:url.includes('auth/o2')?{access_token:'private'}:options.method==='PATCH'?{status:'ACCEPTED'}:{summaries:[{marketplaceId:'APJ6JRA9NG5V4',productType:'SKIN_CARE_AGENT'}],attributes:{product_description:[{value:'Other market',marketplace_id:'OTHER',language_tag:'en_GB'}]}}};};
  const accepted=await publishSheetToChannel({connection:{provider_code:'amazon_sp_api',configurazione:{seller_id:'SELLER',marketplace_ids:['APJ6JRA9NG5V4']}},mapping:{external_sku:'SKU',marketplace:'APJ6JRA9NG5V4'},content,secrets:{lwa_refresh_token:'x',lwa_client_secret:'y'},fetcher:amazonFetcher});
  assert.equal(accepted.status,'accepted');assert.match(accepted.message,/successiva elaborazione/);
  const patch=JSON.parse(amazonCalls.at(-1).options.body);assert.equal(patch.patches[0].path,'/attributes/product_description');assert.equal(patch.patches[0].value[0].value,'Other market');assert.match(patch.patches[0].value[1].value,/INCI\/CTFA/);
});

test('Translation returns a reviewable draft and preserves the exact INCI',async()=>{
  const translated=await translateSheetContent(content,'ENG',{generate:async input=>{assert.match(input.system,/never instructions/);return {output:{...content,description:'Translated',inci:'Wrong'}};}});
  assert.equal(translated.inci,content.inci);assert.equal(translated.description,'Translated');
  await assert.rejects(translateSheetContent(content,'UNKNOWN'),/lingua/);
  await assert.rejects(translateSheetContent(content,'ENG',{generate:async()=>({output:{description:'Only one'}})}),/incompleta/);
});

test('NAS saves only signed matching documents, keeps backups, blocks stale and foreign-origin writes',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'direct-sheets-')),secret='test-only-secret-012345678901234567890123';
  const handler=createGeneratedSheetHandler({root,secret,enabled:true,origins:['https://workspace.progre.it']});
  const server=http.createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const baseUrl=`http://127.0.0.1:${server.address().port}`,pdf=Buffer.from('%PDF-1.7\nFirst test\n%%EOF\n');
  const descriptor={baseUrl,secret,filename:'IT0001.pdf',sha256:createHash('sha256').update(pdf).digest('hex'),size:pdf.length,revision:1,issuedAt:Date.now()};
  const upload=(url,bytes=pdf,origin='https://workspace.progre.it')=>fetch(url,{method:'PUT',headers:{'content-type':'application/pdf',origin},body:bytes});
  try {
    assert.equal((await upload(signSheetArchive({...descriptor,method:'GET'}))).status,403);
    assert.equal((await upload(signSheetArchive(descriptor),pdf,'https://foreign.test')).status,403);
    assert.equal((await upload(signSheetArchive(descriptor),Buffer.from('wrong'))).status,400);
    let saved=await upload(signSheetArchive(descriptor));assert.equal(saved.status,200);assert.equal((await saved.json()).saved,true);
    assert.deepEqual(await readFile(path.join(root,'Schede Tecniche','IT0001.pdf')),pdf);
    const metadata=await (await fetch(signSheetArchive({...descriptor,method:'GET'}))).json();assert.equal(metadata.sha256,descriptor.sha256);
    const second={...descriptor,revision:2,issuedAt:Date.now()+1};assert.equal((await upload(signSheetArchive(second))).status,200);
    assert.equal((await readdir(path.join(root,'Schede Tecniche','.versions'))).length,1);
    assert.equal((await upload(signSheetArchive(descriptor))).status,409);
    await writeFile(path.join(root,'Schede Tecniche','.IT0001.pdf.lock'),'busy');assert.equal((await upload(signSheetArchive(second))).status,409);
    assert.equal((await upload(signSheetArchive({...descriptor,filename:'../outside.pdf'}))).status,400);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('API rejects anonymous requests, wrong methods and archive claims without valid source',async()=>{
  let authorized=0;
  const handler=createSheetHandler({identity:async()=>{authorized++;throw Object.assign(new Error('Denied'),{status:403});}});
  const response=()=>({code:0,body:null,setHeader(){},status(n){this.code=n;return this;},json(value){this.body=value;return this;}});
  let res=response();await handler({method:'GET',headers:{},body:{action:'translate'}},res);assert.equal(res.code,405);assert.equal(authorized,0);
  res=response();await handler({method:'POST',headers:{},body:{action:'translate',productId}},res);assert.equal(res.code,403);assert.equal(authorized,1);
});

test('Database permissions, revisions, translations, template validation and published Club snapshot',async t=>{
  process.env.CLUB_CONTENT_FIXTURE_ONLY='1';
  const {createContentFixture}=await import('./club-catalog-content.test.mjs');const db=await createContentFixture();
  const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
  const as=async level=>db.exec(`reset role;set test.direct_level='${level}';set request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';set role authenticated;`);
  try {
    await db.exec(await readFile(new URL('../supabase/migrations/20261018110000_salidischia_club_store_offers.sql',import.meta.url),'utf8'));
    await db.exec(`alter table prodotti add column if not exists codice text;create table if not exists crm_product_mappings(id uuid primary key);create or replace function public.workspace_access_context() returns jsonb language sql stable as $$select case when current_setting('test.direct_level',true)='nessuno' then '{"modules":[],"module_levels":{}}'::jsonb else jsonb_build_object('modules',jsonb_build_array('prodotti'),'module_levels',jsonb_build_object('prodotti',current_setting('test.direct_level',true))) end$$;`);
    for(const file of ['20261022160000_direct_product_sheets.sql','20261022161000_direct_sheet_languages_archive.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    await t.test('readers cannot save, writers cannot manage templates or publish',async()=>{
      await as('lettura');await assert.rejects(q('select direct_save_product_sheet($1,$2,0)',[productId,content]),/non autorizzata/);
      await as('scrittura');await assert.rejects(q('select direct_save_sheet_template(null,$1,$2,true,0)',['Test',defaultLayout()]),/non autorizzata/);
      await assert.rejects(q('select direct_publish_product_sheet_club($1,1)',[productId]),/non autorizzata/);
    });
    await t.test('saves are atomic, stale versions fail and history is retained',async()=>{
      await q('select direct_save_product_sheet($1,$2,0)',[productId,content]);assert.equal((await q('select filled_count from direct_product_sheet_summaries'))[0].filled_count,6);
      await assert.rejects(q('select direct_save_product_sheet($1,$2,0)',[productId,content]),/altro utente/);
      await assert.rejects(q('update direct_product_sheets set revision=999'),/permission denied/);
      await assert.rejects(q('select direct_save_product_sheet($1,$2,1)',[productId,{...content,unexpected:'x'}]),/non validi/);
      await assert.rejects(q('select direct_save_sheet_translation($1,\'ENG\',$2,1,0,true)',[productId,{...content,inci:'changed'}]),/identico/);
      await q('select direct_save_sheet_translation($1,\'ENG\',$2,1,0,true)',[productId,content]);
    });
    await t.test('template geometry, default uniqueness and concurrent updates are enforced',async()=>{
      await as('amministrazione');const row=(await q('select * from direct_save_sheet_template(null,$1,$2,true,0)',['Template A',defaultLayout()]))[0];
      const invalid=defaultLayout();invalid.boxes[0].x=200;await assert.rejects(q('select direct_save_sheet_template(null,$1,$2,false,0)',['Bad',invalid]),/non validi/);
      await assert.rejects(q('select direct_save_sheet_template($1,$2,$3,true,0)',[row.id,'Template A',defaultLayout()]),/altro utente/);
      await q('select direct_save_sheet_template(null,$1,$2,true,0)',['Template B',defaultLayout()]);assert.equal((await q('select count(*)::int as n from direct_product_sheet_templates where is_default'))[0].n,1);
    });
    await t.test('Club sees only approved publication and keeps pricing and visibility',async()=>{
      await q('select direct_publish_product_sheet_club($1,1)',[productId]);
      const result=(await q('select club_catalog_product($1) as value',[productId]))[0].value;assert.deepEqual(result.product_sheet,content);assert.ok('pricing' in result);
      await q('select direct_save_product_sheet($1,$2,1)',[productId,{...content,description:'New draft'}]);
      const publicResult=(await q('select club_catalog_product($1) as value',[productId]))[0].value;assert.equal(publicResult.product_sheet.description,content.description);
      assert.equal((await q('select count(*)::int as n from direct_product_sheet_history'))[0].n,2);
      await assert.rejects(q('select direct_publish_product_sheet_club($1,1)',[productId]),/completa/);
      await assert.rejects(q('select direct_save_sheet_translation($1,\'ENG\',$2,1,1,true)',[productId,content]),/italiana è cambiata/);
      await db.exec("reset role;set role anon;");await assert.rejects(q('select * from direct_product_sheets'),/permission denied/);
      const anon=(await q('select club_catalog_product($1) as value',[productId]))[0].value;assert.equal(anon.product_sheet.description,content.description);
    });
  } finally {await db.close();}
});

import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { PDFDocument } from 'pdf-lib';
import { SHEET_FIELDS, SHEET_LANGUAGES } from '../shared/directProductSheet.js';
import { createSheetHandler } from '../server/direct-product-sheets.js';
import { createGeneratedSheetHandler } from '../hosting/document-gateway/generated-sheets.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
process.env.CLUB_CONTENT_FIXTURE_ONLY='1';
const { createContentFixture,id } = await import('./club-catalog-content.test.mjs');
const repo=fileURLToPath(new URL('../',import.meta.url)).replaceAll('\\','/').replace(/\/$/,''),out=process.env.DIRECT_SHEETS_BROWSER_OUTPUT || await mkdtemp(path.join(tmpdir(),'direct-sheets-browser-'));
await mkdir(out,{recursive:true});
const db=await createContentFixture(), q=async(sql,args=[])=>(await db.query(sql,args)).rows;
await db.exec(await readFile(new URL('../supabase/migrations/20261018110000_salidischia_club_store_offers.sql',import.meta.url),'utf8'));
await db.exec(`alter table prodotti add column if not exists codice text,add column if not exists formato text;grant select on prodotti to authenticated;create table if not exists crm_product_mappings(id uuid primary key);create or replace function workspace_access_context() returns jsonb language sql stable as $$select jsonb_build_object('modules',jsonb_build_array('prodotti'),'module_levels',jsonb_build_object('prodotti',current_setting('test.direct_level',true)))$$;update prodotti set categoria_mexal='Cura del corpo',formato='50 ml',immagine_catalogo_url='/photo.png' where id='${id(50)}';`);
for(const file of ['20261022160000_direct_product_sheets.sql','20261022161000_direct_sheet_languages_archive.sql','20261023140000_direct_sheet_titles_category.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
const actor=async level=>db.exec(`reset role;set test.direct_level='${level}';set request.jwt.claim.sub='${id(1)}';set role authenticated;`);
const allowed=new Set(['direct_product_sheets','direct_product_sheet_translations','direct_product_sheet_templates','direct_product_sheet_summaries','direct_product_sheet_archives','direct_product_sheet_deliveries','prodotti']);
async function tableQuery(input,service=false){
  if(input.table==='ordini_impianti'||input.table==='crm_product_mappings')return {data:[],error:null};
  if(!allowed.has(input.table))throw Error('Unexpected fixture table: '+input.table);
  if(service)await db.exec('reset role');
  const params=[],bind=value=>{params.push(Array.isArray(value)?JSON.stringify(value):value);return '$'+params.length;};
  const ident=name=>{if(!/^[a-z_][a-z_0-9]*$/.test(name))throw Error('Unsafe column');return name;};
  const where=(input.filters||[]).map(([key,value])=>`${ident(key)}=${bind(value)}`).join(' and ');
  const order=(input.orders||[]).map(([key,asc])=>`${ident(key)} ${asc?'asc':'desc'}`).join(',');
  let sql;
  if(input.insert){const keys=Object.keys(input.insert);sql=`insert into ${input.table}(${keys.map(ident)}) values(${keys.map(k=>bind(input.insert[k]))}) returning *`;}
  else if(input.update){sql=`update ${input.table} set ${Object.entries(input.update).map(([key,value])=>`${ident(key)}=${bind(value)}`)}${where?' where '+where:''} returning *`;}
  else{const columns=input.columns==='*'?'*':String(input.columns).split(',').map(ident).join(',');sql=`select ${columns} from ${input.table}${where?' where '+where:''}${order?' order by '+order:''}${input.limit?' limit '+Number(input.limit):''}${input.range?' limit '+(input.range[1]-input.range[0]+1)+' offset '+input.range[0]:''}`;}
  try{const rows=await q(sql,params);return {data:input.single?rows[0]||null:rows,error:null};}catch(e){return {data:null,error:{message:e.message,code:e.code}};}
}
function dbClient(){return {from(table){const state={table,columns:'*',filters:[],orders:[]};const chain={select(c='*'){state.columns=c;return chain;},eq(k,v){state.filters.push([k,v]);return chain;},order(k,{ascending=true}={}){state.orders.push([k,ascending]);return chain;},limit(v){state.limit=v;return chain;},single(){state.single=true;return chain;},maybeSingle(){state.single=true;return chain;},insert(v){state.insert=v;return chain;},update(v){state.update=v;return chain;},then(resolve,reject){return tableQuery(state,true).then(resolve,reject);}};return chain;}};}
const secret='fixture-secret-for-direct-sheets-only-0123456789',nasRoot=await mkdtemp(path.join(out,'nas-'));
const nasHandler=createGeneratedSheetHandler({root:nasRoot,secret,enabled:true,origins:[]});
// The fixture proxy supplies the allowed UI origin after Vite starts.
let uiOrigin='';const nas=http.createServer(async(req,res)=>{delete req.headers.origin;if(!await nasHandler(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}});
await new Promise(resolve=>nas.listen(0,'127.0.0.1',resolve));
process.env.DOCUMENT_GATEWAY_URL=`http://127.0.0.1:${nas.address().port}`;process.env.DOCUMENT_GATEWAY_SECRET=secret;
const api=createSheetHandler({onError:e=>console.log('Fixture API:',e.message,e.code),identity:async()=>({db:dbClient(),reader:dbClient(),actorId:id(1)}),photoFetcher:async()=>({ok:true,headers:{'content-type':'image/png'},data:await readFile(repo+'/apps/salidischia-club/public/catalog-logo.png')}),translate:async content=>({...content,category:'Body care',category_source:content.category,description:'A light cream for daily use.',features:'Soft texture.',active_ingredients:'Glycerin.',directions:'Apply to clean skin.',warnings:'For external use only.'})});
const mock=`export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'fixture'}}})},rpc:async(name,args)=>fetch('/__rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args,level:new URLSearchParams(location.search).get('level')||'amministrazione'})}).then(r=>r.json()),from(table){const s={table,columns:'*',filters:[],orders:[]};const c={select(v='*'){s.columns=v;return c},eq(k,v){s.filters.push([k,v]);return c},or(){return c},order(k,{ascending=true}={}){s.orders.push([k,ascending]);return c},range(a,b){s.range=[a,b];return c},limit(v){s.limit=v;return c},single(){s.single=true;return c},maybeSingle(){s.single=true;return c},abortSignal(){return c},then(a,b){return fetch('/__table',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...s,level:new URLSearchParams(location.search).get('level')||'amministrazione'})}).then(r=>r.json()).then(a,b)}};return c}};`;
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import Products from '/src/pages/Products/Products.jsx';import '/src/styles/App.css';createRoot(document.getElementById('root')).render(React.createElement(Products));`;
let queue=Promise.resolve(),vite,browser,currentPage;const errors=[];
try{
 vite=await createServer({root:repo,cacheDir:path.join(out,'vite-cache'),configFile:false,plugins:[{name:'direct-sheets-fixture',enforce:'pre',resolveId(source){if(source==='/__fixture.jsx')return '\0fixture.jsx';},load(file){const p=file.replaceAll('\\','/');if(file==='\0fixture.jsx')return entry;if(p.endsWith('/lib/supabaseClient.js'))return mock;if(p.endsWith('/contexts/AuthContext.jsx'))return `export const useAuth=()=>({canUseModule:(_,level='lettura')=>({nessuno:0,lettura:1,scrittura:2,amministrazione:3}[new URLSearchParams(location.search).get('level')||'amministrazione']>=({lettura:1,scrittura:2,amministrazione:3}[level]))});`;},configureServer(s){s.middlewares.use(async(req,res,next)=>{
  if(req.url==='/photo.png'){res.setHeader('Content-Type','image/png');res.end(await readFile(repo+'/apps/salidischia-club/public/catalog-logo.png'));return;}
  if(req.url?.startsWith('/nas-upload/')){const response=await fetch(req.url.slice('/nas-upload/'.length),{method:req.method,headers:{'Content-Type':req.headers['content-type']||''},body:req.method==='PUT'?req:undefined,duplex:'half'});res.writeHead(response.status,{'Content-Type':'application/json'});res.end(Buffer.from(await response.arrayBuffer()));return;}
  if(req.method==='GET'&&req.url?.startsWith('/fixture.html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__fixture.jsx"></script></body></html>'));return;}
  if(!['/__rpc','/__table'].includes(req.url)&&!req.url?.startsWith('/api/mexal/automation'))return next();
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');
  queue=queue.then(async()=>{try{res.setHeader('Content-Type','application/json');await actor(body.level||'amministrazione');
   if(req.url==='/__rpc'){const entries=Object.entries(body.args||{});if(!/^(direct_|club_)/.test(body.name))throw Error('Unexpected RPC');const rows=await q(`select to_jsonb(x) as value from ${body.name}(${entries.map(([key],i)=>key+'=> $'+(i+1)).join(',')}) x`,entries.map(([,v])=>v));res.end(JSON.stringify({data:rows[0]?.value??null,error:null}));}
   else if(req.url==='/__table')res.end(JSON.stringify(await tableQuery(body)));
   else if(!req.url.includes('direct-product-sheets'))res.end(JSON.stringify({documents:[],sections:[]}));
   else{req.body=body;const bridge={setHeader:(...args)=>res.setHeader(...args),status(code){res.statusCode=code;return this;},json(value){if(value.url?.includes('/generated-sheets/')&&body.action==='prepare_archive')value.url=uiOrigin+'/nas-upload/'+value.url;res.end(JSON.stringify(value));return this;}};await api(req,bridge);}
  }catch(e){res.end(JSON.stringify({data:null,error:{message:e.message,code:e.code}}));}});await queue;
 });}},react()],server:{host:'127.0.0.1',port:0}});
 await vite.listen();uiOrigin=Object.values(vite.resolvedUrls).flat()[0].replace(/\/$/,'');
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1440,height:1050}});currentPage=page;page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(uiOrigin+'/fixture.html');await page.getByRole('button',{name:'Compila Scheda',exact:true}).waitFor();await page.getByRole('button',{name:'Compila Scheda',exact:true}).click();
 for(const field of SHEET_FIELDS)await page.getByLabel(field.label,{exact:true}).fill(field.key==='inci'?'Aqua, Glycerin, Parfum.':field.key==='warnings'?'Uso esterno. Evitare il contatto con gli occhi.':'Crema delicata per uso quotidiano.');
 await page.getByRole('button',{name:'Salva scheda',exact:true}).click();await page.getByText('Scheda salvata.',{exact:true}).waitFor();await page.getByRole('button',{name:'Chiudi',exact:true}).click();
 await page.getByRole('button',{name:'Template scheda tecnica',exact:true}).click();await page.getByRole('heading',{name:'Template scheda tecnica',exact:true}).waitFor();
 const background=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1190;c.height=1684;const ctx=c.getContext('2d');ctx.fillStyle='#fffdf8';ctx.fillRect(0,0,c.width,c.height);ctx.strokeStyle='#c9a56c';ctx.lineWidth=2;ctx.strokeRect(28,28,c.width-56,c.height-56);return c.toDataURL('image/jpeg').split(',')[1];});
 const jpegPath=path.join(out,'template.jpeg');await writeFile(jpegPath,Buffer.from(background,'base64'));await page.getByLabel('Sfondo JPEG',{exact:true}).setInputFiles(jpegPath);
 await page.waitForFunction(()=>document.querySelector('.direct-template-page').style.backgroundImage.includes('data:image/jpeg'));
 await page.getByRole('button',{name:'+ Titolo Descrizione',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Casella Titolo Descrizione',exact:true}).locator('.direct-template-box-content').innerText(),'Descrizione');
 await page.getByLabel('Colore testo',{exact:true}).fill('#cc0000');
 const photoChecks=page.locator('.direct-template-workspace>aside').first();
 await photoChecks.getByLabel('Titolo · Descrizione',{exact:true}).uncheck();await photoChecks.getByLabel('Foto prodotto',{exact:true}).check();
 await page.getByLabel('Blocca proporzioni foto',{exact:true}).check();await page.getByLabel('Larghezza (%)',{exact:true}).fill('13');
 assert.equal(Number(await page.getByLabel('Altezza (%)',{exact:true}).inputValue()),10.5);
 await photoChecks.getByLabel('Foto prodotto',{exact:true}).uncheck();
 await page.getByLabel('Predefinito',{exact:true}).check();
 const checks=page.locator('.direct-template-workspace>aside').first();await checks.getByLabel('Codice articolo',{exact:true}).check();await checks.getByLabel('EAN',{exact:true}).check();
 await page.getByLabel('Posizione X (%)',{exact:true}).fill('20');await checks.getByLabel('Nome prodotto',{exact:true}).check();await page.getByRole('button',{name:'Bordi sinistri',exact:true}).click();
 const positions=await page.locator('.direct-template-box.selected').evaluateAll(nodes=>nodes.map(n=>n.style.left));assert.deepEqual(positions,['6%','6%','6%']);
 await page.getByLabel('Allineamento testo',{exact:true}).selectOption('center');await page.getByLabel('Allineamento verticale testo',{exact:true}).selectOption('middle');
 while(await checks.locator('input:checked').count())await checks.locator('input:checked').first().uncheck();await checks.getByLabel('Descrizione',{exact:true}).check();
 await page.getByLabel('Altezza (%)',{exact:true}).fill('2');await page.getByLabel('Dimensione testo (pt)',{exact:true}).fill('60');await page.getByRole('button',{name:'Anteprima PDF',exact:true}).click();await page.getByRole('alert').filter({hasText:'fuori casella'}).waitFor();
 await page.getByLabel('Altezza (%)',{exact:true}).fill('11');await page.getByLabel('Dimensione testo (pt)',{exact:true}).fill('10');await page.getByRole('button',{name:'Salva template',exact:true}).click();await page.getByText('Template salvato.',{exact:true}).waitFor();
 await page.screenshot({path:path.join(out,'editor.png'),fullPage:true});
 const defaultId=await page.getByLabel('Template salvati',{exact:true}).inputValue();assert.ok(defaultId);
 await page.getByRole('button',{name:'Chiudi',exact:true}).click();
 await page.getByRole('button',{name:'Template scheda tecnica',exact:true}).click();
 await page.waitForFunction(id=>document.querySelector('select[aria-label="Template salvati"]')?.value===id,defaultId);
 assert.equal(await page.getByLabel('Predefinito',{exact:true}).isChecked(),true);
 assert.ok(await page.locator('.direct-template-page').evaluate(node=>node.style.backgroundImage.includes('data:image/jpeg')));
 assert.equal(await page.getByText('Modifiche non salvate',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Chiudi',exact:true}).click();
 await page.getByRole('button',{name:'Compila Scheda',exact:true}).click();await page.getByLabel('Lingua della scheda',{exact:true}).selectOption('ENG');await page.getByRole('button',{name:'Traduci automaticamente dall’italiano salvato',exact:true}).click();await page.getByText(/Traduzione pronta/).waitFor();assert.equal(await page.getByLabel('Categoria tradotta',{exact:true}).inputValue(),'Body care');assert.equal(await page.getByLabel('INCI/CTFA',{exact:true}).inputValue(),'Aqua, Glycerin, Parfum.');
 await page.getByLabel('Ho controllato la traduzione e la approvo per la generazione.',{exact:true}).check();await page.getByRole('button',{name:'Salva scheda',exact:true}).click();await page.getByText('Scheda salvata.',{exact:true}).waitFor();for(const language of ['FR','DE','ES','PT']){
   await page.getByLabel('Lingua della scheda',{exact:true}).selectOption(language);await page.getByRole('button',{name:'Traduci automaticamente dall’italiano salvato',exact:true}).click();await page.getByText(/Traduzione pronta/).waitFor();
   await page.getByLabel('Ho controllato la traduzione e la approvo per la generazione.',{exact:true}).check();await page.getByRole('button',{name:'Salva scheda',exact:true}).click();await page.getByText('Scheda salvata.',{exact:true}).waitFor();
 }
 await page.getByRole('button',{name:'Chiudi',exact:true}).click();
 await page.getByRole('button',{name:'Genera scheda tecnica',exact:true}).click();await page.waitForFunction(id=>document.querySelector('select[aria-label="Template"]')?.value===id,defaultId); for(const language of SHEET_LANGUAGES.filter(l=>l.code!=='IT'))await page.getByRole('checkbox',{name:language.label+' ('+language.code+')',exact:true}).check();await page.getByRole('button',{name:'Genera e salva sul NAS',exact:true}).click();await page.getByText('Salvataggio sul NAS completato e verificato.',{exact:true}).waitFor();
 const pdf=await PDFDocument.load(await readFile(path.join(nasRoot,'Schede Tecniche','IT0492.pdf')));assert.equal(pdf.getPageCount(),6);await page.getByRole('region',{name:'Esiti salvataggio',exact:true}).getByText('IT0492.pdf:',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Genera e salva sul NAS',exact:true}).isEnabled(),true);
 await page.screenshot({path:path.join(out,'pdf-lingue.png'),fullPage:true});await page.getByLabel('Formato',{exact:true}).selectOption('jpeg');await page.getByRole('button',{name:'Genera e salva sul NAS',exact:true}).click();await page.getByText('Salvataggio sul NAS completato e verificato.',{exact:true}).waitFor();
 for(const lang of SHEET_LANGUAGES.map(l=>l.code))assert.equal((await readFile(path.join(nasRoot,'Schede Tecniche',`IT0492_${lang}.jpeg`))).subarray(0,3).toString('hex'),'ffd8ff');
 await page.screenshot({path:path.join(out,'jpeg-lingue.png'),fullPage:true});await page.getByRole('button',{name:'Chiudi',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'prodotto-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.goto(uiOrigin+'/fixture.html?level=lettura');await page.getByRole('button',{name:'Genera scheda tecnica',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Compila Scheda',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Template scheda tecnica',exact:true}).count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: UI → SQL revisions → JPEG template alignment → reviewed translation → six-page PDF → signed NAS writes and checksum confirmation → six language JPEGs and individual save outcomes → read-only permissions → mobile.');console.log('Artifacts: '+out);
}catch(e){console.log('Browser errors:',errors);if(currentPage)await currentPage.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});throw e;}finally{await browser?.close();await vite?.close();await new Promise(resolve=>nas.close(resolve));await db.close();}

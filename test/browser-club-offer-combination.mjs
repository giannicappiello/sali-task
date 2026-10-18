import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
process.env.CLUB_OFFER_FIXTURE_ONLY='1';
const repo=fileURLToPath(new URL('../',import.meta.url)).replaceAll('\\','/').replace(/\/$/,''),root=process.env.CLUB_BROWSER_ROOT || repo+'/apps/salidischia-club';
const { createOfferFixture,id }=await import(pathToFileURL(repo+'/test/club-store-offers.test.mjs'));
const envText=await readFile(repo+'/apps/salidischia-club/.env.local','utf8');const env=Object.fromEntries(envText.split(/\r?\n/).filter(l=>/^VITE_[A-Z_]+=/.test(l)).map(l=>{const p=l.indexOf('=');return [l.slice(0,p),l.slice(p+1).trim().replace(/^['"]|['"]$/g,'')];}));
const db=await createOfferFixture(),q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const actor=async who=>db.exec(`reset role;set request.jwt.claim.sub='${who?id(who):''}';set test.auth='${who?id(who):''}';set role ${who?'authenticated':'anon'};`);
const require=createRequire(root+'/package.json');const {createServer}=await import(pathToFileURL(require.resolve('vite')));const {default:react}=await import(pathToFileURL(require.resolve('@vitejs/plugin-react')));
const original=await readFile(root+'/src/client.js','utf8');
const mock=`const who=Number(new URLSearchParams(location.search).get('actor')||sessionStorage.getItem('testActor')||0);if(who)sessionStorage.setItem('testActor',String(who));const session=who?{user:{id:'test'+who},access_token:'fixture-'+who}:null;export const supabase={auth:{getSession:async()=>({data:{session}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>location.assign('/')},rpc:async(name,args={})=>{const r=await fetch('/__rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args,who})});return r.json();}};`;
const editorHtml=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__editor-entry.jsx"></script></body></html>`;
const editorEntry=`import React from 'react';import{createRoot}from'react-dom/client';import Editor from '/@fs/${repo}/src/modules/crm/club/ClubContents.jsx';import Products from '/@fs/${repo}/src/modules/crm/club/ClubCatalogEditor.jsx';import '/@fs/${repo}/src/modules/crm/club/club.css';import '/@fs/${repo}/src/modules/crm/crm.css';import '/@fs/${repo}/src/styles/App.css';import '/@fs/${repo}/src/styles/compact-headers.css';import '/@fs/${repo}/src/styles/unified-chrome.css';createRoot(document.getElementById('root')).render(React.createElement('div',{className:'crm-page club-page'},React.createElement(location.search.includes('products')?Products:Editor)));`;
let queue=Promise.resolve(),server,browser,origin,page;const errors=[];
const out=process.env.CLUB_BROWSER_OUTPUT || await mkdtemp(join(tmpdir(),'club-content-'));await mkdir(out,{recursive:true});
try {
 server=await createServer({root,cacheDir:root+'/.vite-combination-test',configFile:false,plugins:[{name:'content-fixture',enforce:'pre',resolveId(source){if(source==='/__editor-entry.jsx')return '\0editor-entry.jsx';},load(file){const f=file.replaceAll('\\','/');if(file==='\0editor-entry.jsx')return editorEntry;if(f.endsWith('/src/client.js'))return mock+original.slice(original.indexOf('export async function rpc'));if(f.endsWith('/lib/supabaseClient.js'))return mock;if(f.endsWith('/contexts/AuthContext.jsx'))return 'export const useAuth=()=>({canUseScreen:()=>true});';},configureServer(s){s.middlewares.use(async(req,res,next)=>{
  if(req.url?.startsWith('/editor.html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,editorHtml));return;}
  if(req.url!=='/__rpc'&&req.url!=='/api/club-media')return next();queue=queue.then(async()=>{let input='';for await(const part of req)input+=part;try{const body=JSON.parse(input);let result;
   if(req.url==='/__rpc'){const {name,args,who}=body;if(!/^club_[a-z_]+$/.test(name)||Object.keys(args).some(key=>!/^\w+$/.test(key)))throw Error('Unsupported RPC');if(who===1 && ['club_catalog_categories','club_catalog_products'].includes(name)){const response=await fetch(env.VITE_SUPABASE_URL+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:env.VITE_SUPABASE_ANON_KEY,Authorization:'Bearer '+env.VITE_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});console.log('Catalog read',name,response.status);assert.equal(response.status,200);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:await response.json(),error:null}));return;}await actor(who);await db.exec("set request.path='/rpc/"+name+"'");await q('select club_api_boundary()');const keys=Object.keys(args);result={data:(await q('select public.'+name+'('+keys.map((key,i)=>key+'=> $'+(i+1)).join(',')+') as value',Object.values(args)))[0].value,error:null};}
   else{await db.exec('reset role');const viewer=Number(String(req.headers.authorization||'').split('fixture-')[1])||0;const paths=(await q('select club_media_paths($1,$2) as value',[body.document_ids,viewer?id(viewer):null]))[0].value;result={urls:Object.fromEntries(Object.entries(paths).map(([key,path])=>[key,'https://media.example.test'+path]))};}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch(e){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:null,error:{message:e.message}}));}});
 });}},react()],server:{host:'127.0.0.1',port:0,strictPort:false,fs:{allow:[repo,root]}}});await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;

 browser=await chromium.launch({channel:'msedge',headless:true});
 page=await browser.newPage({viewport:{width:1280,height:960}});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/?actor=1');console.log('Browser opened');
 await page.getByLabel('Modalità di navigazione',{exact:true}).selectOption('preview-store');
 await page.getByRole('button',{name:'Crea Offerta',exact:true}).first().click();
 await page.getByLabel('Titolo offerta',{exact:true}).fill('Natale 2026');
 await page.getByLabel('Tipo di offerta',{exact:true}).selectOption('bundle_gift');
 await page.getByLabel('Cerca prodotti richiesti',{exact:true}).fill('IT0004');
 await page.getByLabel('Cerca prodotti richiesti',{exact:true}).press('Enter');
 await page.getByRole('button',{name:'Prodotti richiesti: aggiungi Resina e Fiamme Eau de Parfum',exact:true}).click();
 await page.getByLabel('Quantità richiesta Resina e Fiamme Eau de Parfum',{exact:true}).fill('2');
 await page.getByLabel('Cerca prodotto in omaggio',{exact:true}).fill('IT0568');
 await page.getByLabel('Cerca prodotto in omaggio',{exact:true}).press('Enter');
 await page.getByRole('button',{name:/Prodotto in omaggio: aggiungi Micellar Water/}).click();
 await page.getByLabel('Rapporto con le altre offerte',{exact:true}).selectOption('stack');
 await page.screenshot({path:out+'/offerta-catalogo-reale-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Salva bozza',exact:true}).click();
 await page.getByRole('button',{name:'Pubblica offerta salvata',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 async function discount(title,mode,percent){
  await page.getByRole('button',{name:'Crea Offerta',exact:true}).click();
  await page.getByLabel('Titolo offerta',{exact:true}).fill(title);
  await page.getByLabel('Rapporto con le altre offerte',{exact:true}).selectOption(mode);
  await page.getByLabel('Sconto (%)',{exact:true}).fill(String(percent));
  await page.getByRole('button',{name:'Salva bozza',exact:true}).click();await page.getByRole('button',{name:'Pubblica offerta salvata',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 }
 await discount('Natale sconto 20','replace',20);await discount('Natale extra 10','stack',10);
 assert.equal(await page.locator('.history-list .badge').filter({hasText:'Attiva'}).count(),3);
 await page.getByLabel('Modalità di navigazione',{exact:true}).selectOption('preview-member');
 await page.locator('.shop-offer-card').filter({has:page.getByRole('heading',{name:'Natale 2026',exact:true})}).click();
 await page.getByRole('button',{name:'Calcola vantaggio',exact:true}).click();
 await page.locator('.offer-quote-line strong').filter({hasText:'18,00'}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/catalogo-reale-cumulo-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log('PASS browser: real IT0004 and IT0568 selectable, quantity/gift, three offers concurrently published, 25 euro with 20% then 10% = 18 euro, mobile layout.');
} catch(error) {if(page){console.log((await page.locator('body').innerText()).slice(-12000));await page.screenshot({path:out+'/failure.png',fullPage:true});}throw error;} finally {if(browser)await browser.close();if(server)await server.close();await db.close();}

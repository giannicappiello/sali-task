import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
process.env.CLUB_OFFER_FIXTURE_ONLY='1';process.env.CLUB_SUPPLY_FIXTURE_ONLY='1';
const repo=fileURLToPath(new URL('../',import.meta.url)).replaceAll('\\','/').replace(/\/$/,''),root=repo+'/apps/salidischia-club';
const { createSupplyFixture,supplyTransport,id }=await import(pathToFileURL(repo+'/test/club-supply-orders.test.mjs'));
const {handleClubSupply}=await import(pathToFileURL(repo+'/server/club-supply-orders.js'));
const db=await createSupplyFixture(),q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const actor=async who=>db.exec(`reset role;set request.jwt.claim.sub='${who?id(who):''}';set test.auth='${who?id(who):''}';set role ${who?'authenticated':'anon'};`);
const require=createRequire(root+'/package.json');const {createServer}=await import(pathToFileURL(require.resolve('vite')));const {default:react}=await import(pathToFileURL(require.resolve('@vitejs/plugin-react')));
const original=await readFile(root+'/src/client.js','utf8');
await actor(2);let cart=[{product_id:id(50),quantity:2},{product_id:id(51),quantity:1}];let quote=(await q('select club_quote_order($1) value',[cart]))[0].value;await q('select club_send_order($1,$2,$3)',[cart,id(971),quote]);await actor(3);await q("select club_select_store('A')");cart=[{product_id:id(50),quantity:3},{product_id:id(52),quantity:2}];quote=(await q('select club_quote_order($1) value',[cart]))[0].value;await q('select club_send_order($1,$2,$3)',[cart,id(972),quote]);
const mock=`const who=Number(new URLSearchParams(location.search).get('actor')||sessionStorage.getItem('testActor')||0);if(who)sessionStorage.setItem('testActor',String(who));const session=who?{user:{id:'test'+who},access_token:'fixture-'+who}:null;export const supabase={auth:{getSession:async()=>({data:{session}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>location.assign('/')},rpc:async(name,args={})=>{const r=await fetch('/__rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args,who})});return r.json();}};`;
const editorHtml=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__editor-entry.jsx"></script></body></html>`;
const editorEntry=`import React from 'react';import{createRoot}from'react-dom/client';import Editor from '/@fs/${repo}/src/modules/crm/club/ClubContents.jsx';import Products from '/@fs/${repo}/src/modules/crm/club/ClubCatalogEditor.jsx';import '/@fs/${repo}/src/modules/crm/club/club.css';import '/@fs/${repo}/src/modules/crm/crm.css';import '/@fs/${repo}/src/styles/App.css';import '/@fs/${repo}/src/styles/compact-headers.css';import '/@fs/${repo}/src/styles/unified-chrome.css';createRoot(document.getElementById('root')).render(React.createElement('div',{className:'crm-page club-page'},React.createElement(location.search.includes('products')?Products:Editor)));`;
let queue=Promise.resolve(),server,browser,origin,supplyCalls=0;const errors=[];
const out=process.env.CLUB_BROWSER_OUTPUT || await mkdtemp(join(tmpdir(),'club-content-'));await mkdir(out,{recursive:true});
try {
 server=await createServer({root,cacheDir:process.env.CLUB_BROWSER_OUTPUT+'/vite-cache',configFile:false,plugins:[{name:'content-fixture',enforce:'pre',resolveId(source){if(source==='/__editor-entry.jsx')return '\0editor-entry.jsx';},load(file){const f=file.replaceAll('\\','/');if(file==='\0editor-entry.jsx')return editorEntry;if(f.endsWith('/src/client.js'))return mock+original.slice(original.indexOf('export async function rpc'));if(f.endsWith('/lib/supabaseClient.js'))return mock;if(f.endsWith('/contexts/AuthContext.jsx'))return 'export const useAuth=()=>({canUseScreen:()=>true});';},configureServer(s){s.middlewares.use(async(req,res,next)=>{
  if(req.url?.startsWith('/editor.html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,editorHtml));return;}
  if(!['/__rpc','/api/club-media','/api/club-supply-order'].includes(req.url))return next();queue=queue.then(async()=>{let input='';for await(const part of req)input+=part;try{const body=JSON.parse(input);let result;
   if(req.url==='/api/club-supply-order'){supplyCalls++;await db.exec('reset role');const transport=supplyTransport(db);transport.auth={getUser:async token=>({data:{user:{id:id(Number(token.split('-')[1]))}}})};const wrapper={headers:{},setHeader(k,v){res.setHeader(k,v);},status(n){res.statusCode=n;return this;},json(body){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return this;}};await handleClubSupply({method:'POST',headers:req.headers,body:{payload:body}},wrapper,transport);return;}if(req.url==='/__rpc'){const {name,args,who}=body;if(!/^club_[a-z_]+$/.test(name)||Object.keys(args).some(key=>!/^\w+$/.test(key)))throw Error('Unsupported RPC');await actor(who);await db.exec("set request.path='/rpc/"+name+"'");await q('select club_api_boundary()');const keys=Object.keys(args);result={data:(await q('select public.'+name+'('+keys.map((key,i)=>key+'=> $'+(i+1)).join(',')+') as value',Object.values(args)))[0].value,error:null};}
   else{await db.exec('reset role');const viewer=Number(String(req.headers.authorization||'').split('fixture-')[1])||0;const paths=(await q('select club_media_paths($1,$2) as value',[body.document_ids,viewer?id(viewer):null]))[0].value;result={urls:Object.fromEntries(Object.entries(paths).map(([key,path])=>[key,'https://media.example.test'+path]))};}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch(e){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:null,error:{message:e.message}}));}});
 });}},react()],server:{host:'127.0.0.1',port:0,strictPort:false,fs:{allow:[repo]}}});await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;

 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/?actor=4');await page.getByRole('button',{name:'Genera ordine',exact:true}).click();
 await page.getByRole('heading',{name:"Genera ordine a PROGRE'",exact:true}).waitFor();
 await page.getByLabel('Quantità ordine PROGRE IT0492',{exact:true}).waitFor();assert.equal(await page.getByLabel('Quantità ordine PROGRE IT0492',{exact:true}).inputValue(),'5');
 await page.getByLabel('Quantità ordine PROGRE IT0492',{exact:true}).fill('4');
 await page.getByRole('button',{name:"Elimina IT-TEST-51 dall'ordine PROGRE",exact:true}).click();
 await page.getByRole('button',{name:"Elimina IT-TEST-52 dall'ordine PROGRE",exact:true}).click();
 await page.getByLabel('Cerca prodotti per ordine PROGRE',{exact:true}).fill('IT-TEST-52');await page.getByLabel('Cerca prodotti per ordine PROGRE',{exact:true}).press('Enter');
 await page.locator('.supply-search-results button').filter({hasText:'IT-TEST-52'}).click();
 await page.getByLabel('Quantità ordine PROGRE IT-TEST-52',{exact:true}).fill('3');
 await page.getByRole('button',{name:'Aggiorna prezzi e riepilogo',exact:true}).click();
 await page.locator('.supply-totals .purchase-total strong').filter({hasText:'352,58'}).waitFor();
 await page.locator('.supply-note textarea').fill('Consegna prossima settimana');
 await page.screenshot({path:out+'/genera-ordine-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Conferma invio all’agente',exact:true}).click();
 const modal=page.getByRole('dialog',{name:"Conferma ordine a PROGRE'",exact:true});await modal.waitFor();assert.ok((await modal.innerText()).includes('Anna Agente'));
 await modal.getByRole('button',{name:'Invia ordine all’agente',exact:true}).click();await modal.waitFor({state:'hidden'});
 await page.getByText(/Ordine W\/TEST inviato a Anna Agente/).waitFor();
 await page.getByLabel('Quantità ordine PROGRE IT0492',{exact:true}).waitFor();assert.equal(await page.getByLabel('Quantità ordine PROGRE IT0492',{exact:true}).inputValue(),'1');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/ordine-inviato-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await db.exec('reset role');assert.equal((await q('select count(*)::int n from ordini_testate'))[0].n,1);assert.equal((await q('select count(*)::int n from notifiche'))[0].n,1);
 const priorCalls=supplyCalls;
 await page.goto(origin+'/?actor=1');await page.getByLabel('Modalità di navigazione',{exact:true}).selectOption('preview-store');
 await page.getByRole('button',{name:'Genera ordine',exact:true}).click();
 await page.getByText(/Genera ordine richiede l’accesso di un negozio reale/).waitFor();assert.equal(supplyCalls,priorCalls);
 assert.deepEqual(errors,[]);console.log('PASS browser: grouped customer orders, quantity edits, product removal/addition, reserved prices, VAT/shipping totals, final agent confirmation, one Workspace order and notification, remaining quantities and mobile layout.');
}finally{if(browser)await browser.close();if(server)await server.close();await db.close();}

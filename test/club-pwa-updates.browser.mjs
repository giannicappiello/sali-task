import { createServer } from 'node:http';
import { readFile, cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=await mkdtemp(join(tmpdir(),'club-pwa-update-')),out=join(base,'screenshots');
const build=fileURLToPath(new URL('../apps/salidischia-club/dist/',import.meta.url));
await mkdir(base,{recursive:true});await mkdir(out,{recursive:true});
for(const version of ['A','B']){
 const dir=join(base,version);await cp(build,dir,{recursive:true});
 const html=await readFile(join(dir,'index.html'),'utf8');await writeFile(join(dir,'index.html'),html.replace('</head>',`<script>window.__testVersion='${version}'</script></head>`));
 const sw=await readFile(join(dir,'sw.js'),'utf8');await writeFile(join(dir,'sw.js'),sw.replace(/url:"index.html",revision:"[^"]+"/,`url:"index.html",revision:"test-version-${version}"`));
}
let version='A';
const mime={'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.webp':'image/webp','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=path==='/'?'index.html':decodeURIComponent(path.slice(1));if(file.includes('..'))throw Error();res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(join(base,version,file)));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext();await context.route('**/rest/v1/rpc/club_shop_offers',r=>r.fulfill({json:{rows:[],total:0,store_code:null}}));await context.route('**/rest/v1/rpc/club_feed',r=>r.fulfill({json:{rows:[],total:0}}));await context.route('**/rest/v1/rpc/club_public_info',r=>r.fulfill({json:{program:null,registration_available:false,terms_url:null,privacy_url:null}}));
 const errors=[];const a=await context.newPage();a.on('pageerror',e=>errors.push(e.message));
 await a.goto(origin);await a.getByRole('heading',{name:/La bellezza/}).waitFor();await a.evaluate(()=>navigator.serviceWorker.ready);await a.waitForFunction(()=>!!navigator.serviceWorker.controller);
 assert.equal(await a.getByText('Nuova versione disponibile',{exact:true}).count(),0);
 const b=await context.newPage();b.on('pageerror',e=>errors.push(e.message));await b.goto(origin);await b.getByLabel('Email',{exact:true}).fill('modulo-aperto@example.test');await a.getByLabel('Email',{exact:true}).fill('in-corso@example.test');
 version='B';await a.evaluate(async()=>{await(await navigator.serviceWorker.getRegistration()).update();});
 await a.getByText('Nuova versione disponibile',{exact:true}).waitFor();await b.getByText('Nuova versione disponibile',{exact:true}).waitFor();
 assert.equal(await a.evaluate(()=>window.__testVersion),'A');assert.equal(await a.getByLabel('Email',{exact:true}).inputValue(),'in-corso@example.test');
 await a.setViewportSize({width:390,height:844});await a.screenshot({path:out+'/avviso-aggiornamento-mobile.png',fullPage:true});assert.ok(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await a.getByRole('button',{name:'Più tardi',exact:true}).click();await a.getByRole('button',{name:'Aggiornamento disponibile',exact:true}).waitFor();assert.equal(await a.getByLabel('Email',{exact:true}).inputValue(),'in-corso@example.test');
 await a.getByRole('button',{name:'Aggiornamento disponibile',exact:true}).click();await a.getByRole('button',{name:'Aggiorna ora',exact:true}).click();await a.waitForFunction(()=>window.__testVersion==='B');
 assert.equal(await b.evaluate(()=>window.__testVersion),'A');assert.equal(await b.getByLabel('Email',{exact:true}).inputValue(),'modulo-aperto@example.test');
 await b.getByRole('button',{name:'Aggiorna ora',exact:true}).click();await b.waitForFunction(()=>window.__testVersion==='B');
 assert.deepEqual(errors,[]);console.log('PASS real service-worker update: first install silent; new version waits; form preserved after Later; explicit update loads new version; other tab keeps form until its own confirmation.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

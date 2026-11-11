/* global process */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=process.cwd(),entry=path.join(root,'__preparation_controls.jsx').replaceAll('\\','/'),output=process.env.PREPARATION_UI_OUTPUT;
await fs.mkdir(output,{recursive:true});
const source=`import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import OrderPreparation from '/src/pages/Warehouse/OrderPreparation.jsx';createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/?id=11111111-1111-4111-8111-111111111111']}><OrderPreparation/></MemoryRouter>);`;
const api=`
import {appendPreparationScan} from '/shared/preparationScanning.js';
const p='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
const product={code:'IT0001',description:'Prodotto di prova',scannedValue:'IT0001',piecesPerCarton:3,boxesPerPallet:4,unitWeightGrams:100};
let row={id:'11111111-1111-4111-8111-111111111111',version:1,status:'draft',source:{lines:[{...product,quantity:100}],customerName:'Cliente prova',series:1,number:123,year:2026},state:{pallets:[{id:p,number:1}],packages:[{id:b,palletId:p,number:1}],scans:[],confirmedLots:false}};
window.__preparationCalls=[];
export async function preparationApi(operation,body={}){
 window.__preparationCalls.push({operation,...body});
 if(operation==='resolve_product')return{product};
 if(operation==='audit')return{events:[]};
 if(operation==='scan'){row={...row,version:row.version+1,state:appendPreparationScan(row.state,product,body,body.eventId,'actor',()=>crypto.randomUUID(),new Date().toISOString())};return{preparation:structuredClone(row),scan:{code:product.code,quantity:row.state.scans.filter(s=>s.operationId===body.eventId).reduce((n,s)=>n+s.quantity,0)}};}
 if(operation==='remove_scan'){row.state.scans=row.state.scans.filter(s=>s.id!==body.scanId);row.version++;}
 if(operation==='remove_pallet'){const ids=row.state.packages.filter(s=>s.palletId===body.palletId).map(s=>s.id);row.state.scans=row.state.scans.filter(s=>!ids.includes(s.packageId));row.state.packages=row.state.packages.filter(s=>!ids.includes(s.id));row.state.pallets=row.state.pallets.filter(s=>s.id!==body.palletId);row.version++;}
 return{preparation:structuredClone(row),canWrite:true,canConfigure:false};
}`;
const server=await createServer({root,cacheDir:path.join(output,"vite-cache"),define:{"import.meta.env.VITE_SUPABASE_URL":JSON.stringify("http://127.0.0.1:54321"),"import.meta.env.VITE_SUPABASE_ANON_KEY":JSON.stringify("test-only")},configFile:false,plugins:[react(),{name:'preparation-controls-fixture',resolveId(id){if(id==='/__preparation_controls.jsx')return entry;},load(id){if(id===entry)return source;},transform(code,id){if(id.replaceAll('\\','/').endsWith('/Warehouse/preparationApi.js'))return{code:api,map:null};},configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/__preparation-test')return next();res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__preparation_controls.jsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0},logLevel:'error'});
await server.listen();let browser;
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 for(const width of [1280,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},permissions:['camera']});const page=await context.newPage();const errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/__preparation-test');
  await page.getByRole('button',{name:'Scansiona prodotti',exact:true}).click();
  const camera=page.getByRole('dialog',{name:'Fotocamera'});await camera.waitFor();
  const quantity=camera.getByRole('spinbutton',{name:'Quantità da aggiungere'});await quantity.waitFor();assert.equal(await quantity.inputValue(),'1');
  for(const mode of ['piece','carton','pallet']){
   if(mode==='pallet')continue; // API regression separately checks two complete pallets.
   await camera.getByLabel('Modalità scansione').selectOption(mode);await quantity.fill('2');
   await camera.getByRole('textbox',{name:'Barcode o codice articolo IT'}).fill('IT0001');await camera.getByRole('button',{name:'Ricerca rapida',exact:true}).click();
   await camera.getByText('IT0001 · Prodotto di prova',{exact:true}).waitFor();
   await camera.getByRole('button',{name:'Conferma e scansiona successivo'}).click();
   await page.waitForFunction(n=>window.__preparationCalls.filter(c=>c.operation==='scan').length===n,mode==='piece'?1:2);
   assert.equal((await page.evaluate(()=>window.__preparationCalls.filter(c=>c.operation==='scan').at(-1))).units,2);
   await page.waitForFunction(()=>document.querySelector('.op-camera-read')?.textContent==='Acquisisci');
  }
  const measure=await quantity.evaluate(el=>{const r=el.getBoundingClientRect(),f=el.closest('.op-camera-manual').getBoundingClientRect();return{left:r.left,right:r.right,formRight:f.right,view:innerWidth};});assert.ok(measure.left>=0&&measure.right<=measure.view&&measure.right<=measure.formRight+1,JSON.stringify(measure));
  await page.screenshot({path:path.join(output,'camera-'+width+'.png')});
  await camera.getByRole('button',{name:'Chiudi fotocamera'}).click();
  const button=page.getByRole('button',{name:'Elimina lettura',exact:true}).first();await button.click();
  const remove=page.getByRole('dialog',{name:'Elimina lettura',exact:true});await remove.getByLabel('Motivo').fill('Lettura di prova duplicata');await remove.getByRole('button',{name:'Elimina lettura',exact:true}).click();await remove.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Elimina Bancale 1',exact:true}).click();
  const pallet=page.getByRole('dialog',{name:'Elimina Bancale 1',exact:true});await pallet.getByLabel('Motivo').fill('Bancale di prova errato');await pallet.getByRole('button',{name:'Elimina Bancale 1',exact:true}).click();await pallet.waitFor({state:'detached'});
  assert.equal(await page.getByRole('button',{name:'Elimina lettura',exact:true}).count(),0);assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS preparation controls width '+width);await context.close();
 }
}finally{await browser?.close();await server.close();}

import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)).replaceAll('\\','/').replace(/\/$/,'');
const output=process.env.QUANTITY_POPUP_OUTPUT || await mkdtemp(path.join(tmpdir(),'quantity-popup-'));
await mkdir(output,{recursive:true});
const entry=root+'/__quantity-popup-fixture.jsx';
const source=`import React from 'react';import {createRoot} from 'react-dom/client';
import BrandedDialogProvider from '/src/components/BrandedDialogProvider.jsx';
import {showCartonViolations} from '/src/modules/orders/services/orderQuantityDialog.js';
import {validateOrderCartons} from '/src/modules/orders/services/orderCartonRules.js';
const errors=validateOrderCartons([{codice_articolo:'ART-01',quantita:5}],[{id:'r',modulo_ordini:'ph',tipo:'multiple_of',valore:6,prodotti:['ART-01'],messaggio:'Articolo venduto a cartoni completi',attiva:true}],'ph');
window.showLongQuantityError=()=>showCartonViolations(Array.from({length:20},(_,i)=>({message:'ART-'+i+': Multipli di 6. Quantità inserita: 5.'})));
createRoot(document.getElementById('root')).render(<><div style={{transform:'translateZ(0)',height:1800,paddingTop:1400}}><button id="quantity-error" onClick={()=>void showCartonViolations(errors)}>Ordina ART-01</button></div><BrandedDialogProvider/></>);`;
const server=await createServer({root,configFile:false,plugins:[react(),{
 name:'quantity-popup-fixture',resolveId(id){if(id==='/__quantity-popup-fixture.jsx')return entry;},load(id){if(id===entry)return source;},
 configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url!=='/__quantity-popup-test')return next();res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__quantity-popup-fixture.jsx"></script></body></html>'));});}
}],server:{host:'127.0.0.1',port:0},logLevel:'error'});
await server.listen();const port=server.httpServer.address().port;
let browser;
try {
 browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const [name,width,height,mobile,keyboard] of [['desktop',1440,900,false,false],['mobile',390,844,true,false],['mobile-small',320,568,true,false],['mobile-landscape',844,390,true,false],['mobile-keyboard',390,844,true,true]]) {
  const context=await browser.newContext({viewport:{width,height},isMobile:mobile,deviceScaleFactor:1,hasTouch:mobile});
  if(keyboard)await context.addInitScript(()=>{
   const viewport=new EventTarget();Object.assign(viewport,{width:390,height:360,offsetTop:35,offsetLeft:0});
   Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+port+'/__quantity-popup-test');
  await page.locator('#quantity-error').click();
  const popup=page.getByRole('alertdialog');await popup.waitFor();
  await popup.evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished));});
  const measure=()=>popup.evaluate(el=>{const r=el.getBoundingClientRect(),v=window.visualViewport;return{x:r.x,y:r.y,width:r.width,height:r.height,dx:Math.abs(r.x+r.width/2-(v.offsetLeft+v.width/2)),dy:Math.abs(r.y+r.height/2-(v.offsetTop+v.height/2)),right:r.right,bottom:r.bottom,viewportWidth:v.width,viewportHeight:v.height,scroll:window.scrollY};});
  let rect=await measure();assert.ok(rect.dx<2 && rect.dy<2,name+': not centered '+JSON.stringify(rect));
  assert.ok(rect.width<=width && rect.height<=rect.viewportHeight,name+': popup overflows visible viewport');
  assert.match(await popup.textContent(),/ART-01: Articolo venduto a cartoni completi.*Multipli di 6/s);
  assert.equal(errors.length,0,errors.join('\n'));
  if(keyboard){
   await page.evaluate(()=>{window.visualViewport.height=300;window.visualViewport.offsetTop=70;window.visualViewport.dispatchEvent(new Event('resize'));});
   await page.waitForFunction(()=>Math.abs(document.querySelector('.brand-dialog-backdrop').getBoundingClientRect().height-300)<1);
   rect=await measure();assert.ok(rect.dx<2 && rect.dy<2,'Keyboard viewport resize lost centering');
  }
  await page.screenshot({path:path.join(output,name+'.png')});
  await popup.getByRole('button',{name:'OK',exact:true}).click();await popup.waitFor({state:'detached'});
  if(name==='mobile-small') {
   await page.evaluate(()=>{void window.showLongQuantityError();});
   await popup.waitFor();await popup.evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished));});
   const long=await measure();assert.ok(long.dx<2 && long.dy<2 && long.height<=long.viewportHeight,'Long article list is not centered/contained');
   assert.ok(await popup.evaluate(el=>el.scrollHeight>el.clientHeight),'Long message must scroll within popup');
   await page.screenshot({path:path.join(output,'mobile-small-long.png')});
   await popup.getByRole('button',{name:'OK',exact:true}).click();await popup.waitFor({state:'detached'});
  }
  console.log(name+': popup centered, delta '+rect.dx.toFixed(2)+' / '+rect.dy.toFixed(2)+' px');
  await context.close();
 }
 console.log('Screenshots: '+output);
} finally {await browser?.close();await server.close();}

import assert from 'node:assert/strict';
import { readFile,mkdir } from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
process.env.CLUB_OFFER_FIXTURE_ONLY='1';
const {createOfferFixture,id}=await import('./club-store-offers.test.mjs');
const db=await createOfferFixture();
await db.exec(await readFile(new URL('../supabase/migrations/20261018150000_salidischia_club_customer_orders.sql',import.meta.url),'utf8'));
const browser=await chromium.launch({channel:'msedge',headless:true});
const origin=process.env.CLUB_TEST_ORIGIN || 'http://127.0.0.1:5198';
const out=process.env.CLUB_TEST_OUTPUT || 'C:/Progetti/output/club-customer-orders';
await mkdir(out,{recursive:true});
let queue=Promise.resolve();
const failures=[];
async function context(actor){
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
 if(actor)await ctx.addInitScript(({user})=>localStorage.setItem('salidischia-club-session',JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'test@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}}})),{user:id(actor)});
 await ctx.route('**/rest/v1/rpc/*',async route=>{
  const run=async()=>{
   let name=new URL(route.request().url()).pathname.split('/').pop(),args=route.request().postDataJSON() || {};
   try{
    await db.exec(`reset role;set request.jwt.claim.sub='${actor?id(actor):''}';set test.auth='${actor?id(actor):''}';set role ${actor?'authenticated':'anon'};`);
    if(name==='club_pdf_sections'){await route.fulfill({json:[]});return;}
    if(name==='club_browse_catalog'){name='club_catalog_products';delete args.section_id;}
    assert.match(name,/^club_[a-z_]+$/);const keys=Object.keys(args);keys.forEach(k=>assert.match(k,/^[a-z_]+$/));
    const values=keys.map(k=>args[k]);
    const result=await db.query(`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) as data`,values);
    await route.fulfill({json:result.rows[0].data});
   }catch(error){await route.fulfill({status:400,json:{message:error.message,code:error.code || 'ERROR'}});}
  };
  queue=queue.then(run,run);await queue;
 });
 return ctx;
}
try{
 const member=await context(2),page=await member.newPage();page.on('pageerror',e=>failures.push(e.message));
 await page.goto(origin+'/prodotti');await page.getByRole('button',{name:'Ordina',exact:true}).first().waitFor();
 await page.getByRole('button',{name:'Scopri il prodotto',exact:true}).first().click();
 assert.equal(await page.getByRole('link',{name:/Scopri sul sito/}).count(),0);
 await page.getByRole('dialog').getByRole('button',{name:'Ordina',exact:true}).click();
 const cart=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Carrello',exact:true})});
 await cart.getByRole('spinbutton').fill('2');await cart.getByText('Totale ordine',{exact:true}).waitFor();
 await cart.getByRole('button',{name:'Invia ordine al tuo negozio',exact:true}).click();
 await cart.getByText('Ordine inviato al tuo negozio.',{exact:false}).waitFor();await cart.getByText('Inviato',{exact:true}).waitFor();
 await page.screenshot({path:out+'/cliente-ordine-inviato.png',fullPage:true});
 const store=await context(4),retailer=await store.newPage();retailer.on('pageerror',e=>failures.push(e.message));
 await retailer.goto(origin);await retailer.getByRole('heading',{name:'Ordini in arrivo',exact:true}).waitFor();
 await retailer.getByRole('button',{name:/Ordini in arrivo/}).click();
 await retailer.getByRole('button',{name:'Conferma ricezione ordine',exact:true}).click();
 await retailer.getByText('Ricezione confermata',{exact:true}).waitFor();
 await retailer.getByRole('button',{name:'Comunica disponibilità per il ritiro',exact:true}).click();
 await retailer.getByText('Disponibile per il ritiro',{exact:true}).waitFor();
 await retailer.screenshot({path:out+'/negozio-ordine-pronto.png',fullPage:true});
 await cart.getByRole('button',{name:'Aggiorna ordini',exact:true}).click();await cart.getByText('Disponibile per il ritiro',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:out+'/cliente-ritiro-mobile.png',fullPage:true});
 // Cart survives a reload, and an anonymous visitor gets an actionable sign-in prompt.
 const guest=await context(null),anon=await guest.newPage();await anon.goto(origin+'/prodotti');await anon.getByRole('button',{name:'Ordina',exact:true}).first().click();await anon.getByRole('link',{name:'Accedi al Club',exact:true}).waitFor();await anon.reload();await anon.getByRole('button',{name:'Carrello (1)',exact:true}).click();await anon.getByRole('link',{name:'Accedi al Club',exact:true}).waitFor();
 assert.deepEqual(failures,[]);
 console.log('PASS browser with isolated real PostgreSQL RPCs: product detail and card ordering, quantity, checkout, store home card, receipt, pickup update visible to customer, mobile layout, guest login and cart persistence.');
}finally{await browser.close();await db.close();}

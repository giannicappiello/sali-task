import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
process.env.CLUB_CONTENT_FIXTURE_ONLY='1';
const {createContentFixture,id}=await import('./club-catalog-content.test.mjs');
export {id};
export async function createOfferFixture(){
 const db=await createContentFixture();
 await db.exec(`reset role;alter table prodotti add column prezzo_listino numeric,add column prezzo_listino_ivato numeric,add column aliquota_iva numeric;
 update prodotti set prezzo_listino=100,aliquota_iva=22 where id='${id(50)}';
 insert into prodotti(id,nome,codice_mexal,prezzo_listino,aliquota_iva) values('${id(51)}','Olio corpo','IT-TEST-51',50,22),('${id(52)}','Mini crema omaggio','IT-TEST-52',20,22);
 insert into club_catalog_products(product_id,display_name)select id,nome from prodotti where id in ('${id(51)}','${id(52)}');
 delete from club_catalog_product_categories;insert into club_catalog_product_categories values('${id(50)}',881),('${id(51)}',76),('${id(52)}',74);
 insert into club_stores(store_code) values('A'),('B');
 insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values('${id(4)}','store-a@example.test','{"club_app":"salidischia-club"}',now()),('${id(5)}','store-b@example.test','{"club_app":"salidischia-club"}',now());
 insert into club_store_users(auth_user_id,store_code) values('${id(4)}','A'),('${id(5)}','B');
 `);
 await db.query('select club_catalog_products()');await db.query('select club_catalog_product($1)',[id(50)]);
 await db.exec(await readFile(new URL('../supabase/migrations/20261018110000_salidischia_club_store_offers.sql',import.meta.url),'utf8'));
 return db;
}
if(!process.env.CLUB_OFFER_FIXTURE_ONLY)test('Store offers: ownership, exact prices, best discounts, conditional rewards and trusted-store boundaries',async t=>{
 const db=await createOfferFixture(),q=async(sql,args=[])=>(await db.query(sql,args)).rows,rpc=async(sql,args=[])=>(await q(sql,args))[0].value;
 const actor=async who=>db.exec(`reset role;set request.jwt.claim.sub='${who?id(who):''}';set test.auth='${who?id(who):''}';set role ${who?'authenticated':'anon'};`);
 const save=async payload=>rpc('select club_save_store_offer($1) as value',[payload]);
 const own=async id=>(await rpc('select club_my_store_offers() as value')).rows.find(row=>row.id===id);
 const publish=async id=>q('select club_publish_store_offer($1,$2)',[id,(await own(id)).updated_at]);
 const pricing=async product=>(await rpc('select club_catalog_product($1) as value',[id(product)])).pricing;
 let all,category,product,gift,bundle;
 try{
  await t.test('only an enabled retailer owns its offers; drafts do not alter prices',async()=>{
   await actor(4);all=await save({title:'Tutto -10%',kind:'discount',scope:'all',discount_percent:10});
   assert.equal((await pricing(50)).price,100);await actor(2);await assert.rejects(save({title:'No',kind:'discount',discount_percent:10}),/non autorizzato|negozio non attivo/);
   await actor(5);await assert.rejects(q('select club_publish_store_offer($1,$2)',[all,new Date().toISOString()]),/non disponibile/);await assert.rejects(q('select club_my_store_offers(0,\'A\')'),/tuo negozio/);
   await actor(4);await publish(all);await assert.rejects(q('select * from club_store_offers'),/permission denied/);
  });
  await t.test('Mexal list price without added VAT, descendant categories and product discounts choose the best instead of stacking',async()=>{
   await actor(4);category=await save({title:'Viso -20%',kind:'discount',scope:'category',category_id:72,discount_percent:20});await publish(category);
   product=await save({title:'Crema -25%',kind:'discount',scope:'product',product_id:id(50),discount_percent:25});await publish(product);
   await actor(2);let p=await pricing(50);assert.equal(p.list_price,100);assert.equal(p.price,75);assert.equal(p.discount_percent,25);assert.equal(p.store_code,'A');assert.equal((await pricing(51)).price,45);assert.equal((await pricing(52)).price,16);
   await actor(3);p=await pricing(50);assert.equal(p.price,100);assert.equal(p.offers.length,0);await actor(null);assert.equal((await pricing(50)).discount_percent,0);assert.equal((await rpc('select club_shop_offers() as value')).total,0);
  });
  await t.test('explicit sale prices compete with percentages, support missing references and never invent negative savings',async()=>{
   await actor(4);const fixed=await save({title:'Crema a 70 euro',kind:'discount',scope:'product',product_id:id(50),discount_mode:'price',sale_price:70});await publish(fixed);
   await actor(2);assert.equal((await pricing(50)).price,70);assert.equal((await pricing(50)).discount_percent,30);assert.equal((await pricing(50)).price_mode,'price');
   await actor(4);await q('select club_publish_store_offer($1,$2,true)',[fixed,(await own(fixed)).updated_at]);
   const worse=await save({title:'Crema a 90 euro',kind:'discount',scope:'product',product_id:id(50),discount_mode:'price',sale_price:90});await publish(worse);await actor(2);assert.equal((await pricing(50)).price,75);
   await actor(4);await q('select club_publish_store_offer($1,$2,true)',[worse,(await own(worse)).updated_at]);
   await db.exec('reset role');await q('update prodotti set prezzo_listino=null where id=$1',[id(52)]);await actor(4);
   const missing=await save({title:'Mini a 8 euro',kind:'discount',scope:'product',product_id:id(52),discount_mode:'price',sale_price:8});await publish(missing);await actor(2);assert.equal((await pricing(52)).list_price,null);assert.equal((await pricing(52)).price,8);assert.equal((await pricing(52)).discount_percent,0);
   await actor(4);await q('select club_publish_store_offer($1,$2,true)',[missing,(await own(missing)).updated_at]);await db.exec('reset role');await q('update prodotti set prezzo_listino=20 where id=$1',[id(52)]);
   await actor(4);await assert.rejects(save({title:'Prezzo negativo',kind:'discount',discount_mode:'price',sale_price:-1}),/check constraint/);
   await actor(5);const higher=await save({title:'Vendita a 110 euro',kind:'discount',scope:'product',product_id:id(50),discount_mode:'price',sale_price:110});await publish(higher);await actor(3);assert.equal((await pricing(50)).price,110);assert.equal((await pricing(50)).discount_percent,0);
   await actor(5);await q('select club_publish_store_offer($1,$2,true)',[higher,(await own(higher)).updated_at]);
  });
  await t.test('bundle gifts require all quantities and additional percentages apply sequentially to qualifying products only',async()=>{
   await actor(4);const requirements=[{product_id:id(50),quantity:2},{product_id:id(51),quantity:1}];
   gift=await save({title:'Rituale con omaggio',kind:'bundle_gift',scope:'all',requirements,gift_product_id:id(52),gift_quantity:1});await publish(gift);
   bundle=await save({title:'Ulteriore -10%',kind:'bundle_discount',scope:'all',requirements,discount_percent:10});await publish(bundle);
   await actor(2);const incomplete=[{product_id:id(50),quantity:1},{product_id:id(51),quantity:1}];let quote=await rpc('select club_quote_store_offer($1,$2) as value',[gift,incomplete]);assert.equal(quote.qualifies,false);assert.equal(quote.gift,null);assert.equal(quote.missing[0].required,2);
   const complete=[{product_id:id(50),quantity:2},{product_id:id(51),quantity:1},{product_id:id(52),quantity:1}];quote=await rpc('select club_quote_store_offer($1,$2) as value',[gift,complete]);assert.equal(quote.qualifies,true);assert.equal(quote.gift.product_id,id(52));
   quote=await rpc('select club_quote_store_offer($1,$2) as value',[bundle,complete]);assert.equal(quote.lines.find(row=>row.product_id===id(50)).price,67.5);assert.equal(quote.lines.find(row=>row.product_id===id(51)).price,40.5);assert.equal(quote.lines.find(row=>row.product_id===id(52)).price,16);
   assert.equal((await pricing(50)).price,75);assert.equal((await pricing(50)).offers.some(o=>o.id===bundle),true);
   await actor(3);await assert.rejects(q('select club_quote_store_offer($1,$2)',[gift,complete]),/tuo negozio/);
  });
  await t.test('future, expired, archived offers and immediate trusted-store changes never leak discounts',async()=>{
   await actor(4);for(const window of [{starts_at:'2099-01-01'},{starts_at:'2020-01-01',ends_at:'2021-01-01'}]){const o=await save({title:'Non attiva',kind:'discount',scope:'all',discount_percent:99,...window});await publish(o);}
   await actor(2);assert.equal((await pricing(50)).discount_percent,25);
   await actor(4);const stamp=(await own(product)).updated_at;await q('select club_publish_store_offer($1,$2,true)',[product,stamp]);await assert.rejects(q('select club_publish_store_offer($1,$2,true)',[product,stamp]),/cambiata/);
   await actor(2);assert.equal((await pricing(50)).discount_percent,20);await q("select club_select_store('B')");assert.equal((await pricing(50)).price,100);assert.equal((await rpc('select club_shop_offers() as value')).total,0);
   await db.exec("reset role;update club_stores set enabled=false where store_code='A'");await actor(4);await assert.rejects(q('select club_my_store_offers()'),/non autorizzato|negozio non attivo/);
  });
  await t.test('invalid promotions are rejected and staff retains Workspace store scope',async()=>{
   await db.exec("reset role;update club_stores set enabled=true where store_code='A'");await actor(4);
   for(const percent of [null,0,-1,101,'NaN'])await assert.rejects(save({title:'Non valido',kind:'discount',scope:'all',discount_percent:percent}),/check constraint/);
   await assert.rejects(save({title:'Vuota',kind:'bundle_gift',gift_product_id:id(52),requirements:[]}),/Seleziona/);
   await actor(10);assert.equal((await rpc("select club_my_store_offers(0,'A') as value")).store_code,'A');await assert.rejects(q("select club_my_store_offers(0,'B')"),/ambito Workspace/);
   await actor(2);await db.exec("set request.path='/rpc/club_shop_offers'");await q('select club_api_boundary()');
  });
 }finally{await db.close();}
});

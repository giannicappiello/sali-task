import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
process.env.CLUB_OFFER_FIXTURE_ONLY='1';
const {createOfferFixture,id}=await import('./club-store-offers.test.mjs');

test('product rewards use trusted store prices, quantities, atomic wallet reservation and immutable quote snapshots',async t=>{
 const db=await createOfferFixture(),q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const actor=async n=>db.exec(`reset role;set test.auth='${n?id(n):''}';set request.jwt.claim.sub='${n?id(n):''}';set role ${n?'authenticated':'anon'};`);
 const one=[{product_id:id(50),quantity:1}],basket=[{product_id:id(50),quantity:2},{product_id:id(51),quantity:1}];
 let reward,offer;
 try{
  await db.exec(await readFile(new URL('../supabase/migrations/20261018233000_salidischia_club_reward_selection.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261018235000_salidischia_club_reward_product_pricing.sql',import.meta.url),'utf8'));
  await db.exec(`update club_wallet_movements set available_delta=1000 where member_id='${id(301)}' and kind='earn'`);
  await actor(1);
  reward=(await q('select club_save_reward($1) as id',[{kind:'products',product_scope:'all',name:'Catalogo prodotti',budget_required:9999,stock:10,active:true,delivery_methods:['pickup']}]))[0].id;
  await db.exec('reset role');assert.equal((await q('select budget_required from club_rewards where id=$1',[reward]))[0].budget_required,null);
  await actor(1);await assert.rejects(q('select club_save_reward($1)',[{kind:'prizes',name:'Altro',stock:10,active:true,delivery_methods:['pickup']}]),/constraint/);
  await actor(4);
  offer=(await q('select club_save_store_offer($1) as id',[{title:'Sconto negozio A',kind:'discount',scope:'all',discount_percent:20}]))[0].id;
  let stamp=(await q('select club_my_store_offers() as result'))[0].result.rows.find(row=>row.id===offer).updated_at;
  await q('select club_publish_store_offer($1,$2)',[offer,stamp]);
  const quote=async items=>(await q('select club_quote_product_reward($1,$2) as result',[reward,items]))[0].result;
  await t.test('only members can quote; the trusted store and exact quantities determine the discounted amount',async()=>{
   await actor(null);await assert.rejects(quote(one),/permission denied/);
   await actor(2);let result=await quote(basket);assert.equal(result.total,200);assert.equal(result.store_code,'A');assert.equal(result.items[0].unit_price,80);assert.equal(result.items[1].unit_price,40);
   await actor(3);assert.equal((await quote(one)).total,100);
   await actor(2);assert.equal((await quote([{product_id:id(50),quantity:1},{product_id:id(50),quantity:1}])).total,160);
   for(const items of [[],[{product_id:id(50),quantity:0}],[{product_id:id(50),quantity:-1}],[{product_id:id(50),quantity:1.5}],[{product_id:id(999),quantity:1}]])await assert.rejects(quote(items));
  });
  await t.test('stale or forged amounts are rejected and successful requests reserve only the recalculated total once',async()=>{
   await actor(2);
   const create=async details=>(await q("select club_create_request($1,'products',null,'pickup',$2,$3) as id",[reward,details,id(900)]))[0].id;
   await assert.rejects(create({items:basket,quoted_amount:1}),/prezzo o lo sconto/);
   const request=await create({items:basket,quoted_amount:200,store_code:'B'});assert.equal(await create({items:basket,quoted_amount:200}),request);
   await db.exec('reset role');const row=(await q('select amount,reserved_amount,delivery_details from club_requests where id=$1',[request]))[0];
   assert.equal(Number(row.amount),200);assert.equal(Number(row.reserved_amount),200);assert.equal(row.delivery_details.pricing_store_code,'A');assert.equal(row.delivery_details.items.length,2);
   assert.equal((await q("select count(*)::integer as n from club_wallet_movements where request_id=$1 and kind='reserve'",[request]))[0].n,1);
   assert.equal((await q('select stock from club_rewards where id=$1',[reward]))[0].stock,9);
   await q('update prodotti set prezzo_listino=999 where id=$1',[id(50)]);assert.equal(Number((await q('select amount from club_requests where id=$1',[request]))[0].amount),200);
  });
 } finally {await db.close();}
});
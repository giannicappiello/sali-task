import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
process.env.CLUB_OFFER_FIXTURE_ONLY='1';
const { createOfferFixture,id }=await import('./club-store-offers.test.mjs');
test('Customer product orders: authenticated checkout, exact prices, idempotency, ownership and pickup lifecycle',async()=>{
 const db=await createOfferFixture();
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(sql,args=[])=>(await q(sql,args))[0].value;
 const actor=async n=>db.exec(`reset role;set request.jwt.claim.sub='${n?id(n):''}';set test.auth='${n?id(n):''}';set role ${n?'authenticated':'anon'};`);
 const items=[{product_id:id(50),quantity:2}];
 try{
  await db.exec(await readFile(new URL('../supabase/migrations/20261018150000_salidischia_club_customer_orders.sql',import.meta.url),'utf8'));
  await actor(null);await assert.rejects(q('select club_quote_order($1)',[items]),/permission denied/);
  await actor(4);await assert.rejects(q('select club_quote_order($1)',[items]),/cliente Club/);
  await actor(2);await db.exec("set request.path='/rpc/club_quote_order'");await q('select club_api_boundary()');
  await assert.rejects(q('select * from club_product_orders'),/permission denied/);
  for(const bad of [[],[{product_id:id(50),quantity:0}],[{product_id:id(50),quantity:1.5}],[{product_id:id(50),quantity:null}],[{product_id:id(99),quantity:1}],items.concat(items)])await assert.rejects(q('select club_quote_order($1)',[bad]));
  const quote=await rpc('select club_quote_order($1) value',[items]);assert.equal(quote.total,200);assert.equal(quote.store_code,'A');
  await assert.rejects(q('select club_send_order($1,$2,$3)',[items,id(910),{...quote,total:1}]),/cambiati/);
  const order=await rpc('select club_send_order($1,$2,$3,$4) value',[items,id(910),quote,'Ritiro sabato']);
  assert.equal(await rpc('select club_send_order($1,$2,$3) value',[items,id(910),null]),order);
  assert.equal((await rpc('select club_orders() value')).total,1);
  await actor(3);assert.equal((await rpc('select club_orders() value')).total,0);await assert.rejects(q("select club_update_order($1,'received')",[order]),/negozio non attivo/);
  await actor(5);assert.equal((await rpc('select club_orders() value')).total,0);await assert.rejects(q("select club_update_order($1,'received')",[order]),/non disponibile/);
  await actor(4);let list=await rpc('select club_orders() value');assert.equal(list.incoming,1);assert.equal(list.rows[0].note,'Ritiro sabato');
  await assert.rejects(q("select club_update_order($1,'ready')",[order]),/Conferma prima/);
  await q("select club_update_order($1,'received')",[order]);await q("select club_update_order($1,'received')",[order]);
  await actor(2);list=await rpc('select club_orders() value');assert.equal(list.rows[0].status,'received');assert.ok(list.rows[0].received_at);
  await actor(4);await q("select club_update_order($1,'ready')",[order]);await assert.rejects(q("select club_update_order($1,'received')",[order]),/Conferma prima/);
  await actor(2);list=await rpc('select club_orders() value');assert.equal(list.rows[0].status,'ready');assert.ok(list.rows[0].ready_at);
  // Existing orders stay at their original retailer when the customer changes store.
  await q("select club_select_store('B')");assert.equal((await rpc('select club_orders() value')).rows[0].store_name,quote.store_name);
  await actor(5);assert.equal((await rpc('select club_orders() value')).total,0);
  await actor(4);assert.equal((await rpc('select club_orders() value')).total,1);
  await actor(2);await q("select club_select_store('A')");
  // Live offer calculations, stale-price rejection and free gifts.
  await actor(4);const offer=await rpc('select club_save_store_offer($1) value',[{title:'Test -10%',kind:'discount',scope:'all',combination_mode:'stack',discount_percent:10}]);
  let own=(await rpc('select club_my_store_offers() value')).rows.find(x=>x.id===offer);await q('select club_publish_store_offer($1,$2)',[offer,own.updated_at]);
  const gift=await rpc('select club_save_store_offer($1) value',[{title:'Omaggio due creme',kind:'bundle_gift',scope:'all',combination_mode:'stack',requirements:[{product_id:id(50),quantity:2}],gift_product_id:id(52),gift_quantity:1}]);
  own=(await rpc('select club_my_store_offers() value')).rows.find(x=>x.id===gift);await q('select club_publish_store_offer($1,$2)',[gift,own.updated_at]);
  await actor(2);await assert.rejects(q('select club_send_order($1,$2,$3)',[items,id(911),quote]),/cambiati/);
  const updated=await rpc('select club_quote_order($1) value',[items]);assert.equal(updated.total,180);assert.equal(updated.items.find(x=>x.gift).product_id,id(52));
  await rpc('select club_send_order($1,$2,$3) value',[items,id(911),updated]);
  await db.exec('reset role');await q("update club_members set trusted_store_code=null where auth_user_id=$1",[id(2)]);
  await actor(2);await assert.rejects(q('select club_quote_order($1)',[items]),/negozio di fiducia/);
 }finally{await db.close();}
});

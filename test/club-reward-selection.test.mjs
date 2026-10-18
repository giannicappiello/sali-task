import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isClubRewardProduct,rewardSelectionPayload} from '../src/modules/crm/club/rewardSelection.js';
process.env.CLUB_CONTENT_FIXTURE_ONLY='1';
const {createContentFixture,id}=await import('./club-catalog-content.test.mjs');
test('reward form only accepts IT products and clears irrelevant scope identifiers',()=>{
 assert.equal(isClubRewardProduct({codice_mexal:'IT0569'}),true);assert.equal(isClubRewardProduct({codice_mexal:'FG001'}),false);assert.equal(isClubRewardProduct({codice_mexal:'IT001',attivo_mexal:false}),false);
 assert.deepEqual(rewardSelectionPayload({kind:'products',product_scope:'all',product_ids:['x'],category_ids:[1]}),{product_scope:'all',product_ids:[],category_ids:[],product_id:null});
 assert.deepEqual(rewardSelectionPayload({kind:'products',product_scope:'products',product_ids:['x','y','x']}),{product_scope:'products',product_ids:['x','y'],category_ids:[],product_id:null});
});
test('reward scopes enforce IT-only choices, descendant categories and atomic redemption snapshots',async t=>{
 const db=await createContentFixture(),q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const actor=async n=>db.exec(`reset role;set test.auth='${n?id(n):''}';set request.jwt.claim.sub='${n?id(n):''}';set role ${n?'authenticated':'anon'};`);
 const payload={kind:'products',product_scope:'all',name:'Premio a scelta',budget_required:10,stock:10,active:true,delivery_methods:['pickup']};
 const save=async changes=>(await q('select club_save_reward($1) as id',[{...payload,...changes}]))[0].id;
 try{
  await db.exec(await readFile(new URL('../supabase/migrations/20261018233000_salidischia_club_reward_selection.sql',import.meta.url),'utf8'));
  await db.exec(`reset role;insert into prodotti(id,nome,codice_mexal,attivo_mexal,mostra_in_app) values('${id(51)}','Secondo IT','IT0051',true,true),('${id(52)}','Altro brand','FG0052',true,true),('${id(53)}','IT disattivo','IT0053',false,true);
   insert into club_catalog_categories(id,name,parent_id,slug,source_url)values(9001,'Parent',null,'fixture-parent','https://example.test'),(9002,'Child',9001,'fixture-child','https://example.test');
   insert into club_catalog_products(product_id,display_name)values('${id(51)}','Secondo IT'),('${id(52)}','Altro brand');
   insert into club_catalog_product_categories values('${id(51)}',9002),('${id(52)}',9002);`);
  await actor(1);
  const all=await save({}),multiple=await save({product_scope:'products',product_ids:[id(50),id(51)]}),category=await save({product_scope:'categories',category_ids:[9001]});
  await t.test('UI and forged saves cannot include other brands, inactive products or empty scopes',async()=>{
   for(const changes of [{product_scope:'products',product_ids:[id(52)]},{product_scope:'products',product_ids:[id(53)]},{product_scope:'products',product_ids:[]},{product_scope:'categories',category_ids:[]},{product_scope:'categories',category_ids:[999999]}])await assert.rejects(save(changes),/IT|categorie/i);
  });
  await t.test('only IT products appear for all products, specific products and category descendants',async()=>{
   const choices=async reward=>(await q('select club_reward_products($1) as rows',[reward]))[0].rows.map(p=>p.product_id).sort();
   assert.deepEqual(await choices(all),[id(50),id(51)].sort());assert.deepEqual(await choices(multiple),[id(50),id(51)].sort());assert.deepEqual(await choices(category),[id(51)]);
   await actor(null);await assert.rejects(q('select club_reward_products($1)',[all]),/permission denied/);await assert.rejects(q('select * from club_reward_eligible_products($1)',[all]),/permission denied/);
  });
  await db.exec(`reset role;update club_wallet_movements set available_delta=100 where kind='earn' and member_id='${id(301)}';`);
  await actor(2);
  await t.test('redemption validates actual chosen product and snapshots the trusted name/code',async()=>{
   const create=async product=>(await q("select club_create_request($1,'products',null,'pickup',$2,$3) as id",[category,{product_id:product,product_name:'Forged'},id(300)]))[0].id;
   await assert.rejects(create(id(52)),/Scegli un prodotto IT/);await assert.rejects(create(id(50)),/Scegli un prodotto IT/);
   const request=await create(id(51));assert.equal(await create(id(51)),request);
   await db.exec('reset role');const row=(await q('select reward_name,delivery_details from club_requests where id=$1',[request]))[0];assert.equal(row.reward_name,'Secondo IT');assert.equal(row.delivery_details.product_code,'IT0051');assert.equal(row.delivery_details.product_name,'Secondo IT');assert.equal((await q('select stock from club_rewards where id=$1',[category]))[0].stock,9);
  });
 }finally{await db.close();}
});

/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prCustomerGroupMatches,MYPHARMA_CUSTOMER_CODE} from '../../src/modules/crm/prCustomerGroups.js';

test('the PR category drill-down keeps MyPharma separate by canonical account code',()=>{
 assert.equal(MYPHARMA_CUSTOMER_CODE,'501.00288');
 assert.equal(prCustomerGroupMatches('501.00288','regular'),false);
 assert.equal(prCustomerGroupMatches('501.00288','mypharma'),true);
 assert.equal(prCustomerGroupMatches('other','mypharma'),false);
 assert.equal(prCustomerGroupMatches('other','regular'),true);
 assert.equal(prCustomerGroupMatches('501.00288',null),true);
});

test('PR product summaries and document details cannot mix the two customer groups',{skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
 try{
  await db.exec(await readFile(new URL('./order-dashboard-fixture.sql',import.meta.url),'utf8'));
  await db.exec(`insert into crm_customer_classifications values('501.00288','b2b');
   insert into ordini_clienti_cache values('501.00288','MyPharma Srl','1');
   insert into ordini_testate values('my-ph','501.00288','2026-09-01','prof','standard','aperto','10',null,10);
   insert into ordini_righe(id,ordine_id,codice_articolo,quantita,imponibile_riga,quantita_ocm,prezzo_netto) values('my-line','my-ph','MY-ONLY',10,100,10,10);
   insert into ordini_documenti_mexal values('my-ph','OCM','APERTO',true,now(),'10',2026,'OC');
   set test.visible='A,D,501.00288';`);
  const migration=await readFile(new URL('../../supabase/migrations/20261028133000_crm_pr_mypharma_section.sql',import.meta.url),'utf8');
  for(const name of ['customers','product_rows','product_summary','product_groups','product_detail_lines']){
   const match=migration.match(new RegExp('create or replace function public\\.crm_b2b_order_'+name+'\\([^]*?\\$\\$;','i'));
   assert.ok(match,name);await db.exec(match[0]);
  }
  const summary=group=>db.query("select crm_b2b_order_product_summary($1,'b2b','2026-01-01','2026-10-28','1','prof') data",[group]);
  assert.deepEqual((await summary('regular')).rows[0].data,{purchased:2});
  assert.deepEqual((await summary('mypharma')).rows[0].data,{ordered:1});
  assert.deepEqual((await db.query("select * from crm_b2b_order_customers('mypharma','prof','2026-01-01','2026-10-28')")).rows,[{customer_code:'501.00288'}]);
  const groups=(await db.query("select * from crm_b2b_order_product_groups('mypharma','b2b','2026-01-01','2026-10-28','1','ordered',500,0,'prof')")).rows;
  assert.equal(groups[0].code,'MY-ONLY');assert.equal(Number(groups[0].quantity),10);assert.equal(Number(groups[0].net_amount),100);
  assert.equal((await db.query("select * from crm_b2b_order_product_detail_lines('regular','b2b','2026-01-01','2026-10-28','1','ordered','MY-ONLY',500,0,'prof')")).rows.length,0);
  await db.exec("set test.visible='A,D'");assert.deepEqual((await summary('mypharma')).rows[0].data,{});
 }finally{await db.close();}
});

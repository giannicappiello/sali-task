/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('PR includes invoice-only B2B customers and invoices of PH customers without mixing PH order lines',{skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
 try{
  await db.exec(await readFile(new URL('./order-dashboard-fixture.sql',import.meta.url),'utf8'));
  const source=await readFile(new URL('../../supabase/migrations/20261028133000_crm_pr_mypharma_section.sql',import.meta.url),'utf8');
  for(const name of ['customers','product_rows','product_summary']){
   const definition=source.match(new RegExp('create or replace function public\\.crm_b2b_order_'+name+'\\([^]*?\\$\\$;','i'));
   assert.ok(definition);await db.exec(definition[0]);
  }
  await db.exec(await readFile(new URL('../../supabase/migrations/20261028150000_crm_pr_include_invoiced_customers.sql',import.meta.url),'utf8'));
  await db.exec(`insert into crm_customer_classifications values('E','b2b'),('501.00288','b2b');
  insert into ordini_clienti_cache values('E','PH with invoice','1'),('501.00288','MyPharma Srl','1');
  insert into ordini_testate values('e-ph','E','2026-09-01','ph','standard','aperto','10',null,10);
  insert into ordini_righe(id,ordine_id,codice_articolo,quantita,imponibile_riga) values('e-line','e-ph','PH-ONLY',5,50);
  insert into mexal_fatture_vendita values('e','E','2026-09-03','FT','',1,5,'{}'),('my','501.00288','2026-09-03','FT','',1,6,'{}');
  insert into mexal_fatture_vendita_righe values('e-invoice','e','E-INVOICE','Invoice of PH customer',2,'{}',20,1),('my-invoice','my','MY-INVOICE','MyPharma invoice',1,'{}',100,1);
  set test.visible='A,D,E,501.00288';`);
  const customers=(await db.query("select * from crm_b2b_order_customers('regular','prof','2026-01-01'::date,'2026-10-28'::date,null)")).rows.map(r=>r.customer_code);
  assert.deepEqual(customers,['A','D','E']);
  const summary=(await db.query("select crm_b2b_order_product_summary('regular','b2b','2026-01-01','2026-10-28',null,'prof') data")).rows[0].data;
  assert.deepEqual(summary,{purchased:4});
  assert.deepEqual((await db.query("select crm_b2b_order_product_summary('mypharma','b2b','2026-01-01','2026-10-28',null,'prof') data")).rows[0].data,{purchased:1});
  assert.deepEqual((await db.query("select * from crm_b2b_order_customers('all','ph','2026-01-01'::date,'2026-10-28'::date,null)")).rows.map(r=>r.customer_code),['A','E']);
  assert.deepEqual((await db.query("select * from crm_b2b_order_customers('regular','prof','2026-01-01'::date,'2026-10-28'::date,'2')")).rows.map(r=>r.customer_code),['D']);
  assert.equal((await db.query("select * from crm_b2b_order_customers('regular','prof','2026-10-01'::date,'2026-10-28'::date,null)")).rows.length,0);
  await db.exec("set test.visible='D'");assert.deepEqual((await db.query("select * from crm_b2b_order_customers('regular','prof','2026-01-01'::date,'2026-10-28'::date,null)")).rows.map(r=>r.customer_code),['D']);
  await db.exec('set role anon');await assert.rejects(db.query("select * from crm_b2b_order_customers('regular','prof','2026-01-01'::date,'2026-10-28'::date,null)"),/permission denied/);
 }finally{await db.close();}
});

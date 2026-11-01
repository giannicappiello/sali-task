
/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('B2B financial KPIs share the same net documents, scoped contributors and proportional months',{skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE);const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.role()returns text language sql as $$select 'authenticated'::text$$;
 create function crm_module_for_type(text)returns text language sql as $$select $1$$;
 create function crm_has_module_level(text,text)returns boolean language sql as $$select coalesce(current_setting('test.access',true),'')<>'denied'$$;
 create function crm_visible_customer_areas()returns text[]language sql as $$select array['b2b']::text[]$$;
 create function crm_visible_canonical_customer_codes()returns setof text language sql as $$select unnest(array['A','B','C','M'])$$;
 create table crm_customer_classifications(codice_cliente text,area_crm text);
 create table ordini_clienti_cache(codice_cliente text,ragione_sociale text,codice_agente_mexal text);
 insert into crm_customer_classifications values('A','b2b'),('B','b2b'),('C','b2b'),('M','b2b'),('H','b2b');
 insert into ordini_clienti_cache values('A','Cliente A','g'),('B','Cliente B','h'),('C','Cliente zero','g'),('M','MyPharma','h'),('H','Hidden','h');
 create table test_scope(mod text,grp text,customer_code text);
 insert into test_scope values('ph','all','A'),('prof','regular','A'),('prof','regular','B'),('prof','regular','C'),('prof','mypharma','M');
 create function crm_b2b_order_customers(text,text,date,date,text)returns table(customer_code text)language sql as $$select customer_code from test_scope where mod=$2 and grp=$1$$;
 create table crm_invoice_financials(id uuid,codice_cliente text,data_documento date,sigla text,serie integer,numero integer,net_amount numeric);
 insert into crm_invoice_financials values
 ('00000000-0000-0000-0000-000000000001','A','2024-02-01','FT',1,1,100),
 ('00000000-0000-0000-0000-000000000002','B','2024-02-01','FT',1,2,200),
 ('00000000-0000-0000-0000-000000000003','M','2024-02-01','FT',1,3,300),
 ('00000000-0000-0000-0000-000000000004','C','2024-02-01','FT',1,4,0),
 ('00000000-0000-0000-0000-000000000005','H','2024-02-01','FT',1,5,9999);
 create table crm_sales_orders(id uuid,codice_cliente text,data_ordine date,modulo_ordini text,numero_ordine_visualizzato text,numero_ordine text,numero_progressivo integer);
 insert into crm_sales_orders values
 ('10000000-0000-0000-0000-000000000001','A','2024-02-01','ph','PH1',null,1),
 ('10000000-0000-0000-0000-000000000002','A','2024-02-01','prof','PR1',null,2),
 ('10000000-0000-0000-0000-000000000003','M','2024-02-01','prof','PRM',null,3),
 ('10000000-0000-0000-0000-000000000004','A','2024-02-01','ph','Already invoiced',null,4);
 create table verified(order_id uuid,pr_amount numeric,stralci_amount numeric,ph_amount numeric,oct_amount numeric,prenotazioni_amount numeric);
 insert into verified values
 ('10000000-0000-0000-0000-000000000001',0,0,100,0,0),
 ('10000000-0000-0000-0000-000000000002',50,20,0,0,0),
 ('10000000-0000-0000-0000-000000000003',30,0,0,0,0);
 create function crm_verified_open_order_values_v2()returns setof verified language sql as $$select * from verified$$;`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261101103000_crm_b2b_financial_kpis.sql',import.meta.url),'utf8'));
 const summary=async(mod=null,group=null,agent=null)=>(await db.query("select crm_b2b_financial_kpis('2024-01-01','2024-02-29',$1,$2,$3) data",[agent,mod,group])).rows[0].data;
 const all=await summary();
 assert.equal(all.invoice_total,600);assert.equal(all.order_total,200);assert.equal(all.order_count,3);
 assert.equal(all.average_ph_order,100);assert.equal(all.ph_order_count,1);assert.equal(all.average_invoice,150);
 assert.equal(all.contributors,3);assert.equal(all.months,2);assert.ok(Math.abs(all.monthly_consumption-800/3/2)<1e-9);
 const ph=await summary('ph');assert.equal(ph.order_total,100);assert.equal(ph.invoice_total,100);assert.equal(ph.contributors,1);assert.equal(ph.monthly_consumption,100);
 const pr=await summary('prof','regular');assert.equal(pr.order_total,70);assert.equal(pr.invoice_total,300);assert.equal(pr.contributors,2);assert.equal(pr.monthly_consumption,92.5);
 const my=await summary('prof','mypharma');assert.equal(my.order_total,30);assert.equal(my.invoice_total,300);assert.equal(my.contributors,1);
 const filtered=await summary(null,null,'g');assert.equal(filtered.order_total,170);assert.equal(filtered.invoice_total,100);assert.equal(filtered.contributors,1);
 const details=(await db.query("select d from crm_b2b_financial_details('monthly_consumption','2024-01-01','2024-02-29',null,null,null,200,0)d")).rows.map(r=>r.d);
 assert.equal(details.length,3);assert.equal(details.reduce((s,r)=>s+r.combined_total,0),800);
 const months=(await db.query("select crm_period_months('2024-01-16','2024-02-15')partial,crm_period_months('2024-02-29','2024-02-29')leap")).rows[0];
 assert.ok(Math.abs(Number(months.partial)-(16/31+15/29))<1e-12);assert.ok(Math.abs(Number(months.leap)-1/29)<1e-12);
 await db.exec("insert into crm_invoice_financials values('00000000-0000-0000-0000-000000000006','A','2024-02-01','NC',1,6,-50)");
 assert.equal((await summary()).invoice_total,550);assert.equal((await summary()).average_invoice,110);
 await db.exec("insert into crm_invoice_financials values('00000000-0000-0000-0000-000000000007','A','2024-02-01','FT',1,7,null)");
 const unknown=await summary();assert.equal(unknown.average_invoice,null);assert.equal(unknown.monthly_consumption,null);assert.equal(unknown.average_ph_order,100);
 await db.exec("set test.access='denied'");await assert.rejects(summary(),/non autorizzato/);
 }finally{await db.close();}
});

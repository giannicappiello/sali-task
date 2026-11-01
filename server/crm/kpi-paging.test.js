
import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import process from'node:process';
test('CRM page gateway filters and sorts the entire authorized dataset, groups lazily and returns server totals',async()=>{
 const{PGlite}=await import(process.env.PGLITE_MODULE);const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table visible_products(code text,description text,quantity numeric,net_amount numeric);
 insert into visible_products select 'IT'||lpad(i::text,3,'0'),'Prodotto '||i,i,1000+i from generate_series(1,80)i;
 create function crm_dashboard_product_groups_with_agents_kpi(p_crm_type text,p_from date,p_to date,p_agent text default null,p_category text default null,p_limit integer default 500,p_offset integer default 0)
 returns table(code text,description text,quantity numeric,net_amount numeric)language sql stable security definer as $$select * from visible_products order by code$$;
 grant execute on function crm_dashboard_product_groups_with_agents_kpi(text,date,date,text,text,int,int)to authenticated;
 create function crm_commercial_dashboard_details_kpi(p_metric text,p_from date,p_to date)returns setof jsonb language sql as $$select jsonb_build_object('id',i,'title','FT 1/'||i,'customer_code',case when i<4 then 'A' else 'B'end,'customer_name',case when i<4 then 'Cliente A' else 'Cliente B'end,'amount',i*100,'document_date','2026-10-01')from generate_series(1,5)i$$;
 grant execute on function crm_commercial_dashboard_details_kpi(text,date,date)to authenticated;
 `);
 const migration=await readFile(new URL('../../supabase/migrations/20261101120000_crm_kpi_paged_details.sql',import.meta.url),'utf8');
 await db.exec(migration.slice(migration.indexOf('create function public.crm_kpi_field')));
 const columns=[{key:'code'},{key:'description'},{key:'quantity',format:'number'},{key:'amount',fields:['net_amount'],format:'money'}],parameters={p_crm_type:'b2b',p_from:'2026-01-01',p_to:'2026-11-01',p_category:'reserved'};
 async function page(extra={}){return(await db.query("select crm_kpi_detail_page($1,$2::jsonb,$3::jsonb,p_search=>$4,p_filters=>$5::jsonb,p_sort=>$6,p_direction=>$7,p_limit=>$8,p_offset=>$9,p_transform=>$10,p_customer=>$11,p_restrictions=>$12::jsonb) d",['crm_dashboard_product_groups_with_agents',JSON.stringify(parameters),JSON.stringify(columns),extra.search||'',JSON.stringify(extra.filters||{}),extra.sort||'',extra.direction||'asc',extra.limit||25,extra.offset||0,extra.transform||'rows',null,JSON.stringify(extra.restrictions||[])] )).rows[0].d;}
 await db.exec('set role authenticated');
 let d=await page();assert.equal(d.rows.length,25);assert.equal(d.total,80);assert.equal(d.sums.quantity,3240);assert.equal(d.sums.amount,83240);
 d=await page({sort:'quantity',direction:'desc'});assert.equal(d.rows[0].code,'IT080');assert.equal(d.rows.at(-1).code,'IT056');
 d=await page({sort:'quantity',direction:'desc',offset:25});assert.equal(d.rows[0].code,'IT055');
 d=await page({search:'Prodotto 79'});assert.equal(d.total,1);assert.equal(d.rows[0].code,'IT079');
 d=await page({filters:{amount:'1.080,00'}});assert.equal(d.total,1);assert.equal(d.rows[0].code,'IT080');
 d=await page({restrictions:[{field:'quantity',op:'gt',value:75}]});assert.equal(d.total,5);assert.equal(d.sums.quantity,390);
 d=await page({restrictions:[{field:'code',op:'eq',value:'IT080'}]});assert.equal(d.total,1);
 d=await page({restrictions:[{field:'code',op:'in',value:['IT080','IT079']}]});assert.equal(d.total,2);
 d=await page({search:"';drop table visible_products;--"});assert.equal(d.total,0);
 const invoiceArgs=['crm_commercial_dashboard_details',JSON.stringify({p_metric:'invoices',p_from:'2026-01-01',p_to:'2026-11-01'}),JSON.stringify([{key:'invoice_total',format:'money'}])];
 d=(await db.query("select crm_kpi_detail_page($1,$2::jsonb,$3::jsonb,p_transform=>'invoice_customers')d",invoiceArgs)).rows[0].d;assert.equal(d.total,2);assert.equal(d.rows.find(r=>r.customer_code==='A').documents,3);assert.equal(d.sums.invoice_total,1500);assert.ok(d.rows.every(r=>!r.invoices&&!r.__search));
 d=(await db.query("select crm_kpi_detail_page($1,$2::jsonb,$3::jsonb,p_transform=>'invoice_customers',p_search=>'FT 1/4')d",invoiceArgs)).rows[0].d;assert.equal(d.total,1);assert.equal(d.rows[0].customer_code,'B');
 d=(await db.query("select crm_kpi_detail_page($1,$2::jsonb,$3::jsonb,p_customer=>'B')d",invoiceArgs)).rows[0].d;assert.equal(d.total,2);
 await assert.rejects(db.query("select crm_kpi_detail_page('utenti','{}','[]')"),/Sorgente KPI/);
 await db.exec('set role anon');await assert.rejects(page(),/permission denied/);
 }finally{await db.close();}
});

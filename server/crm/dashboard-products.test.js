/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadDashboardProductSummary,loadDashboardProductRows} from '../../src/modules/crm/dashboardProducts.js';
test('summary is a single request and does not download any document lines',async()=>{
 const calls=[],client={rpc(name,args){calls.push({name,args});return{abortSignal:async()=>({data:{ordered:4,purchased:12}})};}};
 assert.deepEqual(await loadDashboardProductSummary(client,{p_crm_type:'b2b'}),{ordered:4,purchased:12,reserved:0});
 assert.equal(calls.length,1);assert.equal(calls[0].name,'crm_dashboard_product_summary');
 await assert.rejects(loadDashboardProductSummary({rpc(){return{abortSignal:async()=>({error:{message:'denied'}})};}},{}),/denied/);
});
test('lazy details paginate within the selected product and propagate cancellation',async()=>{
 const calls=[],client={rpc(name,args){calls.push(args);return{abortSignal:async()=>({data:Array.from({length:args.p_offset?1:500},(_,i)=>({code:'IT1',id:args.p_offset+i}))})};}};
 assert.equal((await loadDashboardProductRows(client,'crm_dashboard_product_detail_lines',{p_category:'purchased',p_product:'IT1'})).length,501);
 assert.deepEqual(calls.map(c=>c.p_offset),[0,500]);assert.ok(calls.every(c=>c.p_product==='IT1'));
 const controller=new AbortController();controller.abort();
 await assert.rejects(loadDashboardProductRows(client,'x',{},controller.signal),/annullato/);
});
test('SQL summary, product groups and lazy lines retain scope, agents, credits, open-order rules and missing UDM', {skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create function crm_visible_canonical_customer_codes() returns setof text language sql as $$select unnest(string_to_array(coalesce(nullif(current_setting('test.visible',true),''),'A,D'),','))$$;
 create function crm_visible_customer_areas() returns text[] language sql as $$select array['b2b']::text[]$$;
 create table crm_customer_classifications(codice_cliente text,area_crm text);
 create table ordini_clienti_cache(codice_cliente text,ragione_sociale text,codice_agente_mexal text);
 create table ordini_testate(id text,codice_cliente text,data_ordine date,modulo_ordini text,tipo_ordine text,stato text,numero_ordine_visualizzato text,numero_ordine text,numero_progressivo integer);
 create table ordini_righe(id text,ordine_id text,codice_articolo text,descrizione text,quantita numeric,quantita_ocm numeric,quantita_ocx numeric,quantita_oci numeric,unita_misura_oct text,tipo_unita_misura_mexal text,imponibile_riga numeric,prezzo_netto numeric,mexal_posizione integer,riga_descrittiva boolean,mexal_attiva boolean);
 create table ordini_documenti_mexal(ordine_id text,tipo_documento text,stato_operativo text,presente_in_mexal boolean,ultimo_sync_mexal timestamptz,numero text,anno integer,sigla text);
 create table mexal_fatture_vendita(id text,codice_cliente text,data_documento date,sigla text,cod_modulo text,serie integer,numero integer,dati_mexal jsonb);
 create table mexal_fatture_vendita_righe(id text,fattura_id text,codice_articolo text,descrizione text,quantita numeric,dati_mexal jsonb,valore_netto numeric,posizione integer);
 insert into crm_customer_classifications values('A','b2b'),('D','b2b'),('H','b2b'),('O','online');
 insert into ordini_clienti_cache values('A','A','1'),('D','D','2'),('H','H','1'),('O','O','1');
 insert into ordini_testate values('ph','A','2026-09-01','ph','standard','aperto','1',null,1),('reserved','A','2026-09-01','ph','prenotazione','aperto','2',null,2),('pr','A','2026-09-01','prof','standard','aperto','7',null,7);
 insert into ordini_righe(id,ordine_id,codice_articolo,quantita,imponibile_riga,unita_misura_oct,quantita_ocm,quantita_oci) values('1','ph','IT1',5,50,'PZ',null,null),('2','ph','IT1',2,20,null,null,null),('3','reserved','IT2',3,30,null,null,null),('4','pr','OLD',1,10,null,1,null);
 insert into ordini_documenti_mexal values('pr','OCM','APERTO',true,now(),'7',2026,'OC');
 insert into mexal_fatture_vendita values('f','A','2026-09-03','FT','',1,1,'{"numero_ordine":[[1,"7"]],"sigla_ordine":[[1,"OC"]],"data_ordine":[[1,"20260901"]]}'),('nc','A','2026-09-04','NC','',1,2,'{}'),('d','D','2026-09-03','FT','',1,3,'{}'),('h','H','2026-09-03','FT','',1,4,'{}');
 insert into mexal_fatture_vendita_righe values('f1','f','IT1','Crema',10,'{}',100,1),('f2','f','IT3','Altro',2,'{}',null,2),('nc1','nc','IT1','Crema',1,'{}',10,1),('d1','d','IT4','Agente 2',1,'{}',10,1),('h1','h','HIDDEN','Nascosto',1,'{}',10,1);
 `);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261027120000_crm_dashboard_product_summary.sql',import.meta.url),'utf8'));
 const args=['b2b','2026-01-01','2026-10-27','1'];
 const summary=(await db.query('select crm_dashboard_product_summary($1,$2,$3,$4) data',args)).rows[0].data;
 assert.deepEqual(summary,{ordered:1,purchased:2,reserved:1});
 const groups=(await db.query("select * from crm_dashboard_product_groups($1,$2,$3,$4,'purchased')",args)).rows;
 const cream=groups.find(r=>r.code==='IT1');assert.equal(Number(cream.quantity),9);assert.equal(Number(cream.net_amount),90);assert.equal(Number(cream.documents),2);
 assert.equal(Number(groups.find(r=>r.code==='IT3').unknown_amounts),1);
 const ordered=(await db.query("select * from crm_dashboard_product_groups($1,$2,$3,$4,'ordered')",args)).rows;
 assert.equal(Number(ordered[0].quantity),7);
 const lines=(await db.query("select * from crm_dashboard_product_detail_lines($1,$2,$3,$4,'purchased','IT1')",args)).rows;
 assert.equal(lines.length,2);assert.ok(lines.some(r=>Number(r.quantity)===-1));
 assert.equal((await db.query("select crm_dashboard_product_summary('online','2026-01-01','2026-10-27') data")).rows[0].data.constructor,Object);
 assert.deepEqual((await db.query("select crm_dashboard_product_summary('online','2026-01-01','2026-10-27') data")).rows[0].data,{});
 await db.exec("set test.visible='D'");
 assert.deepEqual((await db.query('select crm_dashboard_product_summary($1,$2,$3,$4) data',args)).rows[0].data,{});
 await db.exec('set role anon');
 await assert.rejects(db.query("select crm_dashboard_product_summary('b2b','2026-01-01','2026-10-27')"),/permission denied/);
 }finally{await db.close();}
});

test('product summaries request server-side distinct customer counts without loading document lines',async()=>{
 const calls=[],client={rpc(name,args){calls.push({name,args});return{abortSignal:async()=>({data:[{code:'IT1',customers:241,documents:553}]})};}};
 const rows=await loadDashboardProductRows(client,'crm_dashboard_product_groups',{p_order_module:'prof',p_customer_group:'regular'});
 assert.equal(rows[0].customers,241);
 assert.equal(calls[0].name,'crm_b2b_order_product_groups_with_agents');
 assert.equal(calls[0].args.p_customer_group,'regular');assert.equal(calls.length,1);
});

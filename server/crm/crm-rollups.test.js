/* global process */
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const load=name=>readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8');
const oldViews=(await load('20261028170000_crm_exclude_ft4_artgen.sql')).split('-- Rebind existing')[0];
const rollups=await load('20261030200000_crm_incremental_rollups.sql');
test('incremental rollups preserve exclusions, update only affected documents and retain RLS',{skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();try{
 const orderCols=[...new Set([...oldViews.matchAll(/o\.(\w+)/g)].map(m=>m[1]))];
const numeric=new Set(['totale','totale_imponibile','totale_iva','totale_documento']);
await db.exec(`create role anon;create role authenticated;create role service_role;
 create table ordini_testate(${orderCols.map(c=>c+' '+(numeric.has(c)?'numeric':'text')).join(',')});
 create table ordini_righe(id text,ordine_id text,codice_articolo text,quantita numeric,quantita_ocm numeric,quantita_ocx numeric,quantita_oci numeric,prezzo_netto numeric,imponibile_riga numeric,totale_riga numeric,aliquota_iva numeric,iva_riga numeric,riga_descrittiva boolean,mexal_attiva boolean);
 create table mexal_fatture_vendita(id text primary key,sigla text,cod_modulo text,serie integer,numero bigint,data_documento date,codice_cliente text,ragione_sociale_cliente text,codice_agente_mexal text,agente_nome text,id_pagamento integer,nota text,totale_imponibile numeric,totale_iva numeric,totale_documento numeric,dati_mexal jsonb,sincronizzato_il timestamptz,creato_il timestamptz,aggiornato_il timestamptz,causale_magazzino_codice text,causale_magazzino_descrizione text);
 create table mexal_fatture_vendita_righe(id text,fattura_id text,codice_articolo text,quantita numeric,prezzo_unitario numeric,valore_lordo numeric,valore_netto numeric,aliquota_iva numeric);
 insert into mexal_fatture_vendita(id,sigla,serie,codice_cliente,data_documento,totale_imponibile,totale_iva,totale_documento) values
 ('excluded','FT',4,'A','2026-01-01',100,22,122),
 ('mixed','FT',1,'A','2026-02-01',150,33,183),
 ('only-artgen','CO',1,'A','2026-03-01',50,11,61),
 ('other-series','FT',14,'A','2026-04-01',100,22,122),
 ('credit','NC',4,'A','2026-05-01',-150,-33,-183),
 ('no-lines','FT',1,'A','2026-06-01',30,0,30);
 insert into mexal_fatture_vendita_righe values
 ('1','excluded','IT1',1,100,100,100,22),
 ('2','mixed','IT1',1,100,100,100,22),
 ('3','mixed',' artgen ',1,100,100,50,22),
 ('4','only-artgen','ARTGEN',1,50,50,50,22),
 ('5','other-series','ARTGEN2',1,100,100,100,22),
 ('6','credit','IT1',1,100,100,100,22),
 ('7','credit','ARTGEN',1,50,50,50,22);
 insert into ordini_testate(id,totale_imponibile,totale_iva,totale_documento) values('mixed',150,33,183),('only-artgen',50,11,61),('empty',30,0,30);
 insert into ordini_righe(id,ordine_id,codice_articolo,quantita,quantita_ocm,quantita_ocx,quantita_oci,prezzo_netto,aliquota_iva) values
 ('1','mixed','IT1',1,1,0,0,100,22),('2','mixed','ARTGEN',5,2,1,2,10,22),('3','only-artgen','ARTGEN',1,1,0,0,50,22);
 `);
await db.exec('alter table ordini_testate add primary key(id)');
 await db.exec(oldViews);
 const invoiceBefore=(await db.query('select * from crm_sales_invoices order by id')).rows;
 const orderBefore=(await db.query('select * from crm_sales_orders order by id')).rows;
 // The fixture uses readable text IDs; production IDs and cache keys use UUID.
 await db.exec(rollups.replaceAll('uuid','text'));
 assert.deepEqual((await db.query('select * from crm_sales_invoices order by id')).rows,invoiceBefore);
 assert.deepEqual((await db.query('select * from crm_sales_orders order by id')).rows,orderBefore);
 const amount=async id=>(await db.query('select totale_documento::float value from crm_sales_invoices where id=$1',[id])).rows[0]?.value;
 const cache=async id=>(await db.query('select included_line_net::float net,excluded_net::float excluded from crm_invoice_rollups where fattura_id=$1',[id])).rows[0];
 assert.deepEqual(await cache('mixed'),{net:100,excluded:50});
 await db.exec("update mexal_fatture_vendita_righe set valore_netto=80 where id='2'");
 assert.deepEqual(await cache('mixed'),{net:80,excluded:50});
 await db.exec("update mexal_fatture_vendita_righe set valore_netto=40 where id='3'");
 assert.equal(await amount('mixed'),134.2);
 await db.exec("update mexal_fatture_vendita_righe set codice_articolo='IT-RESTORED' where id='3'");
 assert.equal(await amount('mixed'),183);
 await db.exec("update mexal_fatture_vendita_righe set fattura_id='other-series' where id='3'");
 assert.equal((await cache('mixed')).net,80);assert.equal((await cache('other-series')).net,140);
 await db.exec("delete from mexal_fatture_vendita_righe where fattura_id='other-series'");
 assert.equal((await cache('other-series')).net,0);
 await db.exec("update mexal_fatture_vendita set serie=4 where id='mixed'");assert.equal(await amount('mixed'),undefined);
 await db.exec("update mexal_fatture_vendita set serie=1 where id='mixed'");assert.equal(await amount('mixed'),183);
 await db.exec("update ordini_righe set prezzo_netto=20 where id='2'");
 assert.equal((await db.query("select excluded_net::float value from crm_order_rollups where ordine_id='mixed'")).rows[0].value,100);
 await db.exec("delete from ordini_righe where id='2'");
 assert.equal((await db.query("select totale_documento::float value from crm_sales_orders where id='mixed'")).rows[0].value,183);
 await db.exec("insert into mexal_fatture_vendita(id,sigla,serie) values('new','FT',1);insert into mexal_fatture_vendita_righe(id,fattura_id,codice_articolo,valore_netto) values('new-line','new','IT1',17)");
 assert.equal((await cache('new')).net,17);
 await db.exec("delete from mexal_fatture_vendita_righe where fattura_id='new'; delete from mexal_fatture_vendita where id='new'");
 assert.equal(await cache('new'),undefined);
 // Authenticated readers can see only cached IDs that remain visible through source RLS.
 await db.exec("alter table mexal_fatture_vendita enable row level security;create policy source_visible on mexal_fatture_vendita for select to authenticated using(codice_cliente='VISIBLE');grant select on mexal_fatture_vendita to authenticated;set role authenticated");
 assert.equal((await db.query('select * from crm_invoice_rollups')).rows.length,0);
 await assert.rejects(db.query("select crm_refresh_invoice_rollup('mixed')"),/permission denied/);
 await assert.rejects(db.query("update crm_invoice_rollups set excluded_net=0"),/permission denied/);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from crm_invoice_rollups'),/permission denied/);
 }finally{await db.close();}
});

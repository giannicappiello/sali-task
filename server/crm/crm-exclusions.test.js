/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const migration = await readFile(new URL('../../supabase/migrations/20261028170000_crm_exclude_ft4_artgen.sql',import.meta.url),'utf8');

test('CRM exclusions remove only FT series 4 and ARTGEN while preserving source documents', {skip:!process.env.PGLITE_MODULE}, async()=>{
 const {PGlite}=await import(process.env.PGLITE_MODULE), db=new PGlite();
 try {
 // Broad source schemas keep the views identical to production; assertions exercise business outcomes.
 const viewBlock=migration.split('-- Rebind existing')[0];
 const orderCols=[...new Set([...viewBlock.matchAll(/o\.(\w+)/g)].map(m=>m[1]))];
 const numeric=new Set(['totale','totale_imponibile','totale_iva','totale_documento']);
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table ordini_testate(${orderCols.map(c=>c+' '+(numeric.has(c)?'numeric':'text')).join(',')});
 create table ordini_righe(id text,ordine_id text,codice_articolo text,quantita numeric,quantita_ocm numeric,quantita_ocx numeric,quantita_oci numeric,prezzo_netto numeric,imponibile_riga numeric,totale_riga numeric,aliquota_iva numeric,iva_riga numeric,riga_descrittiva boolean,mexal_attiva boolean);
 create table mexal_fatture_vendita(id text,sigla text,cod_modulo text,serie integer,numero bigint,data_documento date,codice_cliente text,ragione_sociale_cliente text,codice_agente_mexal text,agente_nome text,id_pagamento integer,nota text,totale_imponibile numeric,totale_iva numeric,totale_documento numeric,dati_mexal jsonb,sincronizzato_il timestamptz,creato_il timestamptz,aggiornato_il timestamptz,causale_magazzino_codice text,causale_magazzino_descrizione text);
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
 await db.exec(viewBlock);
 const rows=async q=>(await db.query(q)).rows;
 assert.deepEqual((await rows('select id from crm_sales_invoices order by id')).map(r=>r.id),['credit','mixed','no-lines','other-series']);
 assert.deepEqual(await rows("select totale_imponibile::float as net,totale_iva::float as vat,totale_documento::float as gross from crm_sales_invoices where id='mixed'"),[{net:100,vat:22,gross:122}]);
 assert.equal((await rows("select totale_documento::float amount from crm_sales_invoices where id='credit'"))[0].amount,-122);
 assert.equal((await rows("select count(*)::integer n from crm_sales_invoice_lines where upper(trim(codice_articolo))='ARTGEN' or fattura_id='excluded'"))[0].n,0);
 assert.equal((await rows('select count(*)::integer n from mexal_fatture_vendita'))[0].n,6);
 assert.equal((await rows('select count(*)::integer n from mexal_fatture_vendita_righe'))[0].n,7);
 assert.deepEqual(await rows("select totale_imponibile::float net,totale_documento::float gross from crm_sales_orders where id='mixed'"),[{net:100,gross:122}]);
 assert.equal((await rows("select count(*)::integer n from crm_sales_orders where id='only-artgen'"))[0].n,0);
 assert.deepEqual(await rows("select ocm_amount::float ocm,ocx_amount::float ocx,oci_amount::float oci from crm_order_exclusions where ordine_id='mixed'"),[{ocm:20,ocx:10,oci:20}]);
 assert.equal((await rows('select count(*)::integer n from crm_sales_order_lines'))[0].n,1);
 } finally {await db.close();}
});

test('accounting invoice lineage remains raw; CRM readers use filtered sources',()=>{
 const blocks=[...migration.matchAll(/invoice_refs as materialized \([\s\S]*?\n\s*\),/g)].map(m=>m[0]);
 assert.ok(blocks.length>=8);
 for(const block of blocks){assert.match(block,/public\.mexal_fatture_vendita\b/);assert.doesNotMatch(block,/crm_sales_invoices/);}
 assert.match(migration,/security_invoker = true/);
 assert.match(migration,/revoke all[\s\S]*from public, anon/);
 assert.doesNotMatch(migration,/delete from|update public\.mexal_fatture/i);
});

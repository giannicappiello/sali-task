-- Run after the candidate migration, inside the same transaction; always ROLLBACK.
create temp table crm_classified_customers as select * from public.crm_classified_customers limit 0;
create temp table crm_accounts as select * from public.crm_accounts limit 0;
create temp table crm_order_kpi_source as select * from public.crm_order_kpi_source limit 0;
create temp table ordini_righe as select * from public.ordini_righe limit 0;
create temp table mexal_fatture_vendita as select * from public.mexal_fatture_vendita limit 0;
create temp table mexal_fatture_vendita_righe as select * from public.mexal_fatture_vendita_righe limit 0;
do $fixture$
declare definition text; tab text;
begin
 definition:=pg_get_functiondef('public.crm_customer_product_lines(text,text,text)'::regprocedure);
 definition:=replace(definition,'public.crm_customer_product_lines','pg_temp.crm_customer_product_lines');
 foreach tab in array array['crm_classified_customers','crm_accounts','crm_order_kpi_source','ordini_righe','mexal_fatture_vendita_righe','mexal_fatture_vendita'] loop
   definition:=replace(definition,'public.'||tab,'pg_temp.'||tab);
 end loop;
 execute definition;
end $fixture$;
insert into pg_temp.crm_classified_customers(codice_cliente,ragione_sociale,area_crm) values('QA-B','Test B2B','b2b'),('QA-C','Test BtoC','online');
insert into pg_temp.crm_order_kpi_source(id,codice_cliente,data_ordine,stato,numero_ordine_visualizzato,mexal_sigla) values
 ('10000000-0000-4000-8000-000000000001','QA-B','2026-08-01','aperto','1/100','OC'),
 ('10000000-0000-4000-8000-000000000002','QA-C','2026-08-02','annullato','1/200','OC');
insert into pg_temp.ordini_righe(id,ordine_id,codice_articolo,descrizione,quantita,unita_misura_oct,prezzo_listino,imponibile_riga,sconto_percentuale,riga_descrittiva,mexal_attiva,mexal_posizione) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','IT1','Crema',2,'PZ',10,10,50,false,true,1),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','IT2','Sapone',3,'PZ',5,15,0,false,true,2),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','OLD','Ritirata',9,'PZ',5,45,0,false,false,3),
 ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','IT1','Crema',1,'PZ',10,10,0,false,true,1);
insert into pg_temp.mexal_fatture_vendita(id,codice_cliente,data_documento,sigla,cod_modulo,serie,numero,totale_imponibile) values
 ('30000000-0000-4000-8000-000000000001','QA-B','2026-08-01','FT','',1,10,100),
 ('30000000-0000-4000-8000-000000000002','QA-C','2026-08-02','NC','',1,20,10),
 ('30000000-0000-4000-8000-000000000003','QA-B','2026-08-03','OC','X',1,30,90);
insert into pg_temp.mexal_fatture_vendita_righe(id,fattura_id,posizione,codice_articolo,descrizione,quantita,prezzo_unitario,valore_netto) values
 (1,'30000000-0000-4000-8000-000000000001',1,'IT1','Crema',10,10,100),
 (2,'30000000-0000-4000-8000-000000000002',1,'IT1','Crema',1,10,10),
 (3,'30000000-0000-4000-8000-000000000003',1,'IT1','Crema',9,10,90);
insert into pg_temp.crm_classified_customers(codice_cliente,ragione_sociale,area_crm) values('QA-P','Test PRIVATE','conto_terzi');
insert into pg_temp.crm_accounts(id,codice_cliente_mexal,tipo) values('40000000-0000-4000-8000-000000000001','QA-P','conto_terzi');
insert into pg_temp.crm_order_kpi_source(id,codice_cliente,data_ordine,stato,numero_ordine_visualizzato,mexal_sigla) values('10000000-0000-4000-8000-000000000003','QA-P','2026-08-01','aperto','2/100','OC');
insert into pg_temp.ordini_righe(id,ordine_id,codice_articolo,descrizione,quantita,unita_misura_oct,prezzo_listino,imponibile_riga,riga_descrittiva,mexal_attiva,mexal_posizione) values('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000003','FP1','Prodotto PRIVATE',20,'KG',10,200,false,true,1);
insert into pg_temp.mexal_fatture_vendita(id,codice_cliente,data_documento,sigla,cod_modulo,serie,numero,totale_imponibile) values('30000000-0000-4000-8000-000000000004','QA-P','2026-08-01','FT','',2,10,150);
insert into pg_temp.mexal_fatture_vendita_righe(id,fattura_id,posizione,codice_articolo,descrizione,quantita,prezzo_unitario,valore_netto) values(4,'30000000-0000-4000-8000-000000000004',1,'FP1','Prodotto PRIVATE',15,10,150);
do $assert$
declare n integer; amount numeric;
begin
 select count(*),sum(net_amount) into n,amount from pg_temp.crm_customer_product_lines('mexal:QA-P','ordered','conto_terzi');
 assert n=1 and amount=200,'PRIVATE order missing';
 select count(*),sum(net_amount) into n,amount from pg_temp.crm_customer_product_lines('mexal:QA-P','purchased','conto_terzi');
 assert n=1 and amount=150,'PRIVATE invoice missing';
 select count(*) into n from pg_temp.crm_customer_product_lines('crm:40000000-0000-4000-8000-000000000001','ordered','conto_terzi');
 assert n=1,'Linked CRM key not supported';
 select count(*) into n from pg_temp.crm_customer_product_lines('mexal:QA-P','ordered','b2b');
 assert n=0,'PRIVATE rows leaked into B2B context';
 select count(*) into n from pg_temp.crm_customer_product_lines('mexal:QA-B','ordered','conto_terzi');
 assert n=0,'B2B rows leaked into PRIVATE context';
 select count(*),sum(net_amount) into n,amount from pg_temp.crm_customer_product_lines('mexal:QA-B','ordered','b2b');
 assert n=2 and amount=25,'B2B regression';
 select count(*),sum(net_amount) into n,amount from pg_temp.crm_customer_product_lines('mexal:QA-C','purchased','online');
 assert n=1 and amount=-10,'BtoC credit regression';
 select count(*) into n from pg_temp.crm_customer_product_lines('mexal:QA-P','ordered',null);
 assert n=1,'Unfiltered selector missing PRIVATE';
end $assert$;

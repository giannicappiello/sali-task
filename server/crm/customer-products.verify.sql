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
do $assert$
declare n integer; amount numeric; q numeric; d text;
begin
 select count(*),sum(net_amount) into n,amount from pg_temp.crm_customer_product_lines('mexal:QA-B','ordered','b2b');
 assert n=2 and amount=25,'Canonical order rows, withdrawn rows or total incorrect';
 select discount into d from pg_temp.crm_customer_product_lines('mexal:QA-B','ordered','b2b') where product_code='IT1';
 assert d='50','Discount fallback missing';
 select count(*) into n from pg_temp.crm_customer_product_lines('mexal:QA-B','ordered','online');
 assert n=0,'Context filter crossed';
 select count(*),sum(net_amount) into n,amount from pg_temp.crm_customer_product_lines('mexal:QA-B','purchased','b2b');
 assert n=1 and amount=100,'Invoice branch duplicated OCX';
 select net_amount,quantity into amount,q from pg_temp.crm_customer_product_lines('mexal:QA-C','purchased','online');
 assert amount=-10 and q=-1,'Credit signs incorrect';
 select count(*) into n from pg_temp.crm_customer_product_lines('mexal:QA-C','ordered',null) where excluded_from_totals;
 assert n=1,'Canceled status lost';
 select count(*) into n from public.workspace_schermate where codice in ('crm.prodotti_ordinati','crm.prodotti_acquistati') and cardinality(aree)=0 and area is null;
 assert n=2,'Screens unexpectedly assigned';
 select count(*) into n from public.workspace_moduli_schermate where schermata_codice in ('crm.prodotti_ordinati','crm.prodotti_acquistati');
 assert n=0,'Modules unexpectedly assigned';
end $assert$;

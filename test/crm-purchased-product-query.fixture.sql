-- Isolated scratch PostgreSQL database only. Never execute against production.
-- Run with psql -v ON_ERROR_STOP=1 -f test/crm-purchased-product-query.fixture.sql

create role anon;create role authenticated;create role service_role;
create table ordini_clienti_cache(codice_cliente text,ragione_sociale text,codice_agente_mexal text,visible boolean);
create table crm_customer_classifications(codice_cliente text,area_crm text);
create table crm_sales_invoices(id bigint,sigla text,cod_modulo text,serie text,numero text,data_documento date,codice_cliente text);
create table crm_sales_invoice_lines(id bigint,fattura_id bigint,codice_articolo text,descrizione text,quantita numeric,dati_mexal jsonb,valore_netto numeric,posizione integer);
create function crm_visible_canonical_customer_codes() returns setof text language sql as $$ select codice_cliente from ordini_clienti_cache where visible $$;
create function crm_visible_customer_areas() returns text[] language sql as $$ select array['b2b']::text[] $$;
create function crm_dashboard_product_rows(text,date,date,text) returns table(category text,line_id text,document_id text,document_number text,document_date date,document_status text,customer_code text,customer_name text,product_code text,description text,quantity numeric,unit text,net_amount numeric,line_position integer)
language sql as $$select 'ordered'::text,'row','doc','ORD',date '2026-01-01','Open','C1','Visible','ORDERED','Ordered product',1::numeric,'PZ',7::numeric,1$$;
insert into ordini_clienti_cache values('C1','Visible','AG1',true),('HIDDEN','Hidden','AG2',false);
insert into crm_customer_classifications values('C1','b2b'),('HIDDEN','b2b');
insert into crm_sales_invoices values(1,'FT','E','1','1','2026-02-01','C1'),(2,'NC','E','1','2','2026-03-01','C1'),(3,'FT','E','1','3','2026-04-01','C1'),(4,'FT','E','1','4','2026-05-01','HIDDEN'),(5,'FT','E','1','5','2025-01-01','C1'),(6,'OC','E','1','6','2026-05-01','C1'),(7,'FT','E','1','7','2026-05-01','C1');
insert into crm_sales_invoice_lines values(11,1,'A','Old description',10,'{"um":"PZ"}',100,1),(12,2,'A','Credit',2,'{"um":"PZ"}',20,1),(13,3,'A','Latest description',1,'{}',null,1),(14,4,'A','Hidden',100,'{}',999,1),(15,5,'A','Old year',100,'{}',999,1),(16,6,'A','Order must be excluded',100,'{}',999,1),(17,7,'B','Other product',4,'{}',40,1);

\ir ../supabase/migrations/20261031173000_crm_purchased_product_query.sql
do $$ declare g record; n integer; begin
 select * into strict g from crm_dashboard_product_groups('b2b','2026-01-01','2026-10-31',null,'purchased',500,0) where code='A';
 if g.quantity<>9 or g.net_amount<>80 or g.documents<>3 or g.unknown_amounts<>1 or g.description<>'Latest description' then raise exception 'Incorrect totals, credits, scope or description: %',g;end if;
 select count(*) into n from crm_dashboard_product_groups('b2b','2026-01-01','2026-10-31',null,'purchased',500,0);
 if n<>2 then raise exception 'Products duplicated or hidden customer included';end if;
 if exists(select 1 from crm_dashboard_product_groups('b2b','2026-01-01','2026-10-31','AG2','purchased',500,0)) then raise exception 'Agent filter widened';end if;
 if exists(select 1 from crm_dashboard_product_groups('online','2026-01-01','2026-10-31',null,'purchased',500,0)) then raise exception 'Area filter widened';end if;
 select count(*) into n from crm_dashboard_product_detail_lines('b2b','2026-01-01','2026-10-31',null,'purchased','A',500,0);
 if n<>3 then raise exception 'Missing document lines';end if;
 if not exists(select 1 from crm_dashboard_product_detail_lines('b2b','2026-01-01','2026-10-31',null,'purchased','A',1,1) where quantity=-2 and net_amount=-20) then raise exception 'Detail pagination or signed credit changed';end if;
 if exists(select 1 from crm_dashboard_product_detail_lines('b2b','2026-01-01','2026-10-31',null,'purchased',null,500,0)) then raise exception 'Null product broadened detail';end if;
 if not exists(select 1 from crm_dashboard_product_groups('b2b','2026-01-01','2026-10-31',null,'ordered',500,0) where code='ORDERED' and net_amount=7) then raise exception 'Ordered fallback changed';end if;
 if has_function_privilege('anon','crm_dashboard_purchased_product_rows(text,date,date,text,text)','execute') or not has_function_privilege('authenticated','crm_dashboard_purchased_product_rows(text,date,date,text,text)','execute') then raise exception 'Function permissions changed';end if;
end $$;

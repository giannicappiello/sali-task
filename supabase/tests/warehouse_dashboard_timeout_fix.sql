begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare
 code text:='MP-TIMEOUT-'||upper(replace(gen_random_uuid()::text,'-',''));
 result jsonb;
begin
 insert into public.ordini_prodotti_cache(codice_articolo,descrizione,unita_misura,mostra_in_app)
 values(code,'Warehouse timeout regression '||code,'KG',true);
 insert into public.workspace_warehouse_stock_history(snapshot_date,article_code,warehouse_number,warehouse_name,
   unit_of_measure,on_hand,committed,available,unit_cost,source,source_payload,captured_at)
 values(current_date-1,code,1,'Test 1','KG',6,1,5,1,'mexal_progressive','{}',now()-interval '1 day'),
       (current_date-1,code,8,'Test 8','KG',20,2,18,1,'mexal_progressive','{}',now()-interval '1 day'),
       (current_date,code,1,'Test 1','KG',10,3,7,1,'mexal_progressive','{}',now());
 result:=public.workspace_warehouse_dashboard(current_date,null,'MP','KG',code,'all',100,0);
 if (result->>'totalRows')::int<>2 then raise exception 'Latest per-warehouse rows lost';end if;
 if (select sum((r->>'on_hand')::numeric) from jsonb_array_elements(result->'rows') r)<>30
   then raise exception 'Previous warehouse snapshot not retained';end if;
 result:=public.workspace_warehouse_dashboard(current_date,1,'MP','KG',code,'all',100,0);
 if (result->>'totalRows')::int<>1 or (result->'rows'->0->>'on_hand')::numeric<>10
   then raise exception 'Warehouse filter changed';end if;
 result:=public.workspace_warehouse_dashboard(current_date-1,null,'MP','KG',code,'all',100,0);
 if (select sum((r->>'on_hand')::numeric) from jsonb_array_elements(result->'rows') r)<>26
   then raise exception 'Historical stock changed';end if;
 result:=public.workspace_warehouse_dashboard(current_date,null,'CN','KG',code,'all',100,0);
 if (result->>'totalRows')::int<>0 then raise exception 'Article type filter bypassed';end if;
 result:=public.workspace_warehouse_dashboard(current_date,null,'MP','PZ',code,'all',100,0);
 if (result->>'totalRows')::int<>0 then raise exception 'Unit filter bypassed';end if;
 if has_function_privilege('anon','public.workspace_warehouse_dashboard(date,integer,text,text,text,text,integer,integer)','EXECUTE')
   then raise exception 'Warehouse dashboard exposed to anonymous callers';end if;
end $$;
select 'warehouse_dashboard_timeout_fix' as test,'passed' as result;
rollback;

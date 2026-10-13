begin;
do $$
declare code text:='MP-TEST-DIRECT-'||upper(replace(gen_random_uuid()::text,'-',''));
 other text:='MP-TEST-OTHER-'||upper(replace(gen_random_uuid()::text,'-',''));
 stamp timestamptz:=clock_timestamp()-interval '1 minute'; rows jsonb; result jsonb;
begin
 insert into public.ordini_prodotti_cache(codice_articolo,descrizione) values(code,'Transactional direct stock test'),(other,'Unrelated transactional test');
 insert into public.workspace_warehouse_stock(article_code,warehouse_number,warehouse_name,unit_of_measure,on_hand,committed,available,unit_cost,source_payload,synchronized_at,is_current)
 select code,n,'Test','KG',100,50,50,1,jsonb_build_object('source_system','ProgreMES'),stamp-interval '1 hour',true from unnest(array[1,8]) n;
 insert into public.workspace_warehouse_stock(article_code,warehouse_number,warehouse_name,unit_of_measure,on_hand,committed,available,unit_cost,source_payload,synchronized_at,is_current)
 values(other,8,'Test','KG',99,1,98,1,'{}',stamp-interval '1 hour',true);
 rows:=jsonb_build_array(jsonb_build_object('article_code',code,'warehouse_number',1,'warehouse_name','Test 1','unit_of_measure','KG',
  'on_hand',10,'committed',2,'available',8,'unit_cost',1,'source_payload',jsonb_build_object('source_system','Mexal')),
  jsonb_build_object('article_code',code,'warehouse_number',8,'warehouse_name','Test 8','unit_of_measure','KG',
  'on_hand',20,'committed',4,'available',16,'unit_cost',1,'source_payload',jsonb_build_object('source_system','Mexal')));
 result:=public.apply_workspace_mexal_article_stock(code,stamp,rows);
 if result->>'applied'<>'true' then raise exception 'Article stock not applied';end if;
 if (select sum(on_hand) from public.workspace_warehouse_stock where article_code=code)<>30 then raise exception 'Physical stock differs';end if;
 if (select giacenza from public.ordini_prodotti_cache where codice_articolo=code)<>30 or
  (select disponibilita from public.ordini_prodotti_cache where codice_articolo=code)<>24 then raise exception 'Mexal catalog balances differ';end if;
 if (select on_hand from public.workspace_warehouse_stock where article_code=other)<>99 then raise exception 'Unrelated article changed';end if;
 if (select count(*) from public.workspace_warehouse_stock_history where article_code=code)<>2 then raise exception 'Article history incomplete';end if;
 result:=public.apply_workspace_mexal_article_stock(code,stamp-interval '1 minute',rows);
 if result->>'superseded'<>'true' then raise exception 'Stale snapshot not rejected';end if;
 begin
  perform public.apply_workspace_mexal_article_stock(code,stamp, jsonb_build_array(rows->0));
  raise exception 'Incomplete snapshot accepted';
 exception when others then if SQLERRM not like '%INVALID_MEXAL_ARTICLE_STOCK%' then raise;end if;end;
 if (select sum(on_hand) from public.workspace_warehouse_stock where article_code=code)<>30 then raise exception 'Failed snapshot changed stock';end if;
 result:=public.apply_workspace_mes_inventory(gen_random_uuid(),stamp,'retired',rows);
 if result->>'retired'<>'true' then raise exception 'MES stock channel not retired';end if;
 if (select sum(on_hand) from public.workspace_warehouse_stock where article_code=code)<>30 then raise exception 'MES callback changed physical stock';end if;
 if has_function_privilege('authenticated','public.apply_workspace_mexal_article_stock(text,timestamptz,jsonb)','EXECUTE') then raise exception 'Article stock RPC exposed';end if;
 if public.mexal_stock_night_window('2026-10-13T10:00:00Z') then raise exception 'General stock enabled during daytime';end if;
 if not public.mexal_stock_night_window('2026-10-13T21:00:00Z') then raise exception 'Summer 23:00 stock disabled';end if;
 if not public.mexal_stock_night_window('2026-12-13T22:00:00Z') then raise exception 'Winter 23:00 stock disabled';end if;
 if not public.mexal_stock_night_window('2026-10-14T02:00:00Z') then raise exception 'Night stock disabled';end if;
 if public.mexal_stock_night_window('2026-10-14T04:00:00Z') then raise exception 'Automatic stock enabled after 06:00';end if;
 raise notice 'Direct Mexal stock, isolation, stale protection, privileges and night window tests passed';
end $$;

rollback;

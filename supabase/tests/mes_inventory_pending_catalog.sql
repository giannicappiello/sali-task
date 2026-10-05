begin;
do $$
declare
 k text := 'ZZMESKNOWN-'||substr(gen_random_uuid()::text,1,8);
 u text := 'ZZMESUNKNOWN-'||substr(gen_random_uuid()::text,1,8);
 bad text := 'ZZMESDEFERRED-'||substr(gen_random_uuid()::text,1,8);
 stamp timestamptz := now()-interval '30 seconds';
 event uuid := gen_random_uuid(); rows jsonb; result jsonb;
begin
 insert into ordini_prodotti_cache(codice_articolo,descrizione) values(k,'Transactional test');
 select jsonb_agg(jsonb_build_object('article_code',code,'warehouse_number',warehouse,
  'unit_of_measure','PZ','on_hand',case when warehouse=8 then 100 else 0 end,
  'committed',case when warehouse=8 then 10 else 0 end,
  'available',case when warehouse=8 then 90 else 0 end,'unit_cost',1)) into rows
 from unnest(array[k,u]) code cross join unnest(array[1,8]) warehouse;
 result:=apply_workspace_mes_inventory(event,stamp,'test-hash',rows);
 if not (result->>'applied')::boolean then raise exception 'Not applied'; end if;
 if (select count(*) from workspace_mes_inventory_pending where article_code=u)<>2 then raise exception 'Unknown stock lost'; end if;
 if exists(select 1 from ordini_prodotti_cache where codice_articolo=u) then raise exception 'Invented catalog entry'; end if;
 if (select available from workspace_warehouse_stock where article_code=k and warehouse_number=8)<>90 then raise exception 'Known article blocked'; end if;
 result:=apply_workspace_mes_inventory(event,stamp,'test-hash',rows);
 if not (result->>'replay')::boolean then raise exception 'Replay not idempotent'; end if;
 begin
  perform apply_workspace_mes_inventory(event,stamp,'different-hash',rows);
  raise exception 'Conflict accepted';
 exception when others then
  if SQLERRM not like '%INVENTORY_EVENT_CONFLICT%' then raise; end if;
 end;
 select jsonb_agg(value||jsonb_build_object('on_hand',999)) into rows from jsonb_array_elements(rows) where value->>'article_code'=u;
 perform apply_workspace_mes_inventory(gen_random_uuid(),stamp-interval '1 minute','older',rows);
 if (select (row_data->>'on_hand')::numeric from workspace_mes_inventory_pending where article_code=u and warehouse_number=8)<>100 then raise exception 'Older retry replaced newer pending'; end if;
 insert into ordini_prodotti_cache(codice_articolo,descrizione) values(u,'Transactional test');
 if exists(select 1 from workspace_mes_inventory_pending where article_code=u) then raise exception 'Catalog trigger did not replay'; end if;
 if (select available from workspace_warehouse_stock where article_code=u and warehouse_number=8)<>90 then raise exception 'Recovered stock differs'; end if;
 if (select disponibilita from ordini_prodotti_cache where codice_articolo=u)<>90 then raise exception 'Catalog balance differs'; end if;
 perform apply_workspace_mes_inventory(gen_random_uuid(),stamp-interval '1 minute','stale-again',rows);
 if (select on_hand from workspace_warehouse_stock where article_code=u and warehouse_number=8)<>100 then raise exception 'Stale retry overwrote stock'; end if;
 insert into workspace_mes_inventory_pending(article_code,warehouse_number,captured_at,row_data)
 select bad,warehouse,stamp,jsonb_build_object('article_code',bad,'warehouse_number',warehouse,
  'unit_of_measure','PZ','on_hand',null,'committed',0,'available',0,'unit_cost',1)
 from unnest(array[1,8]) warehouse;
 insert into ordini_prodotti_cache(codice_articolo,descrizione) values(bad,'Transactional deferred test');
 if not exists(select 1 from ordini_prodotti_cache where codice_articolo=bad) then raise exception 'Deferred replay blocked catalog'; end if;
 if (select count(*) from workspace_mes_inventory_pending where article_code=bad)<>2 then raise exception 'Failed replay lost its pending stock'; end if;
 perform replay_workspace_mes_inventory_pending();
 if (select count(*) from workspace_mes_inventory_pending where article_code=bad)<>2 then raise exception 'Retry lost deferred stock'; end if;
 if has_table_privilege('authenticated','workspace_mes_inventory_pending','SELECT') then raise exception 'Reserved table exposed'; end if;
 raise notice 'MES pending catalog tests passed';
end $$;
rollback;

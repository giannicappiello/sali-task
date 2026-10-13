begin;
set local lock_timeout='5s';

-- Automatic general stock runs are eligible only during the Italian night.
-- Explicit manual operations and other job types retain their existing behavior.
create or replace function public.mexal_stock_night_window(p_at timestamptz default now())
returns boolean language sql stable set search_path=pg_catalog as $$
 select (p_at at time zone 'Europe/Rome')::time>=time '23:00'
     or (p_at at time zone 'Europe/Rome')::time<time '06:00';
$$;
do $$ declare definition text; begin
 select pg_get_functiondef('public.claim_scheduled_mexal_sync_job_v1(text,integer)'::regprocedure) into definition;
 if position('public.mexal_stock_night_window' in definition)=0 then
  if position('and j.available_at <= now()' in definition)=0 or position('and previous_job.status not in (''completed'', ''skipped'')' in definition)=0 then
   raise exception 'Unexpected stock scheduler definition';end if;
  definition:=replace(definition,'and j.available_at <= now()',
   'and j.available_at <= now() and (j.sync_type <> ''stocks'' or public.mexal_stock_night_window(now()))');
  definition:=replace(definition,'and previous_job.status not in (''completed'', ''skipped'')',
   'and previous_job.status not in (''completed'', ''skipped'') and (previous_job.sync_type <> ''stocks'' or public.mexal_stock_night_window(now()))');
  execute definition;
 end if;
end $$;

-- Retire only the old MES stock authority. Existing balances are retained until
-- a certified direct Mexal refresh succeeds; no product or stock row is deleted.
drop trigger if exists protect_mes_current on public.workspace_warehouse_stock;
drop trigger if exists protect_mes_history on public.workspace_warehouse_stock_history;
drop trigger if exists align_mes_catalog on public.ordini_prodotti_cache;
drop trigger if exists align_mes_products on public.prodotti;
drop trigger if exists replay_mes_inventory_catalog on public.ordini_prodotti_cache;

create or replace function public.apply_workspace_mes_inventory(
 p_event_id uuid,p_captured_at timestamptz,p_hash text,p_rows jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin return jsonb_build_object('retired',true,'source','MEXAL_DIRECT','pendingArticles',0); end $$;
create or replace function public.replay_workspace_mes_inventory_pending()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin return jsonb_build_object('retired',true,'pendingArticles',0); end $$;
revoke all on function public.apply_workspace_mes_inventory(uuid,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_workspace_mes_inventory(uuid,timestamptz,text,jsonb) to service_role;
revoke all on function public.replay_workspace_mes_inventory_pending() from public,anon,authenticated;
grant execute on function public.replay_workspace_mes_inventory_pending() to service_role;

-- Slow older nightly reads must not overwrite a newer manual article refresh.
create or replace function public.protect_direct_mexal_stock()
returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
 if new.source_payload->>'source_system'='ProgreMES' then return old; end if;
 if tg_table_name='workspace_warehouse_stock' then
  if new.synchronized_at<old.synchronized_at then return old; end if;
 else
  if new.captured_at<old.captured_at then return old; end if;
 end if;
 return new;
end $$;
create trigger protect_direct_mexal_current before update on public.workspace_warehouse_stock
 for each row execute function public.protect_direct_mexal_stock();
create trigger protect_direct_mexal_history before update on public.workspace_warehouse_stock_history
 for each row execute function public.protect_direct_mexal_stock();

-- Preserve the operational warehouse aggregation, with Mexal quantities and
-- Mexal customer commitments. MES production commitments never enter this cache.
create or replace function public.align_direct_mexal_catalog_stock()
returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare code text; stock numeric; reserved numeric; free numeric; captured timestamptz;
begin
 code:=case when tg_table_name='prodotti' then to_jsonb(new)->>'codice_mexal' else to_jsonb(new)->>'codice_articolo' end;
 if code ilike 'IT%' or code ilike 'MKT%' then return new; end if;
 if (select count(*) from public.workspace_warehouse_stock where article_code=code and warehouse_number in(1,8)
     and is_current and source_payload->>'source_system' is distinct from 'ProgreMES')<>2 then return new; end if;
 select sum(on_hand),sum(committed),sum(available),max(synchronized_at) into stock,reserved,free,captured
  from public.workspace_warehouse_stock where article_code=code and warehouse_number in(1,8) and is_current;
 new.giacenza:=stock;new.disponibilita:=free;
 if tg_table_name='ordini_prodotti_cache' then new.impegnato:=reserved;new.sincronizzato_il:=captured;
 else new.ultimo_sync_mexal:=captured;end if;
 return new;
end $$;
create trigger align_direct_mexal_catalog before insert or update on public.ordini_prodotti_cache
 for each row execute function public.align_direct_mexal_catalog_stock();
create trigger align_direct_mexal_products before insert or update on public.prodotti
 for each row execute function public.align_direct_mexal_catalog_stock();

-- One requested article, atomic writes for its two operational warehouses only.
create function public.apply_workspace_mexal_article_stock(p_article_code text,p_captured_at timestamptz,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare stock numeric; reserved numeric; free numeric;
begin
 if p_article_code is null or p_article_code<>upper(btrim(p_article_code)) or p_article_code=''
  or p_captured_at is null or p_captured_at>now()+interval '5 minutes'
  or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<>2 then
  raise exception 'INVALID_MEXAL_ARTICLE_STOCK';end if;
 if exists(select 1 from jsonb_to_recordset(p_rows) as x(article_code text,warehouse_number int,on_hand numeric,committed numeric,available numeric,unit_cost numeric,source_payload jsonb)
  where x.article_code is distinct from p_article_code or x.warehouse_number not in(1,8)
  or x.on_hand is null or x.committed is null or x.available is null or x.unit_cost is null
  or x.source_payload->>'source_system' is distinct from 'Mexal')
  or (select count(distinct x.warehouse_number) from jsonb_to_recordset(p_rows) as x(warehouse_number int))<>2 then
  raise exception 'INCOMPLETE_MEXAL_ARTICLE_STOCK';end if;
 if not exists(select 1 from public.ordini_prodotti_cache where codice_articolo=p_article_code) then
  raise exception 'MEXAL_ARTICLE_NOT_IMPORTED';end if;
 perform pg_advisory_xact_lock(hashtextextended('workspace_mexal_article_stock:'||p_article_code,0));
 if exists(select 1 from public.workspace_warehouse_stock where article_code=p_article_code and warehouse_number in(1,8)
  and synchronized_at>p_captured_at) then return jsonb_build_object('superseded',true);end if;
 insert into public.workspace_warehouse_stock(article_code,warehouse_number,warehouse_name,unit_of_measure,
  on_hand,committed,available,unit_cost,source_payload,synchronized_at,is_current)
 select x.article_code,x.warehouse_number,x.warehouse_name,x.unit_of_measure,x.on_hand,x.committed,x.available,
  x.unit_cost,x.source_payload,p_captured_at,true from jsonb_to_recordset(p_rows) as x(article_code text,warehouse_number int,
  warehouse_name text,unit_of_measure text,on_hand numeric,committed numeric,available numeric,unit_cost numeric,source_payload jsonb)
 on conflict(article_code,warehouse_number) do update set warehouse_name=excluded.warehouse_name,
  unit_of_measure=excluded.unit_of_measure,on_hand=excluded.on_hand,committed=excluded.committed,available=excluded.available,
  unit_cost=excluded.unit_cost,source_payload=excluded.source_payload,synchronized_at=excluded.synchronized_at,sync_run_id=null,is_current=true;
 insert into public.workspace_warehouse_stock_history(snapshot_date,article_code,warehouse_number,warehouse_name,
  unit_of_measure,on_hand,committed,available,unit_cost,source,source_payload,captured_at)
 select (p_captured_at at time zone 'Europe/Rome')::date,article_code,warehouse_number,warehouse_name,
  unit_of_measure,on_hand,committed,available,unit_cost,'mexal_progressive',source_payload,p_captured_at
 from public.workspace_warehouse_stock where article_code=p_article_code and warehouse_number in(1,8)
 on conflict(snapshot_date,article_code,warehouse_number) do update set unit_of_measure=excluded.unit_of_measure,
  on_hand=excluded.on_hand,committed=excluded.committed,available=excluded.available,unit_cost=excluded.unit_cost,
  source_payload=excluded.source_payload,captured_at=excluded.captured_at;
 if p_article_code not ilike 'IT%' and p_article_code not ilike 'MKT%' then
  select sum(on_hand),sum(committed),sum(available) into stock,reserved,free from public.workspace_warehouse_stock
   where article_code=p_article_code and warehouse_number in(1,8) and is_current;
  update public.ordini_prodotti_cache set giacenza=stock,impegnato=reserved,disponibilita=free,sincronizzato_il=p_captured_at
   where codice_articolo=p_article_code;
  update public.prodotti set giacenza=stock,disponibilita=free,ultimo_sync_mexal=p_captured_at
   where codice_mexal=p_article_code and sincronizzato_mexal=true;
 end if;
 return jsonb_build_object('applied',true,'source','MEXAL_DIRECT');
end $$;
revoke all on function public.apply_workspace_mexal_article_stock(text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_workspace_mexal_article_stock(text,timestamptz,jsonb) to service_role;
commit;

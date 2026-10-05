begin;
-- Keep unknown catalog codes outside operational stock, without inventing products.
create table public.workspace_mes_inventory_pending (
 article_code text not null, warehouse_number int not null check(warehouse_number in(1,8)),
 captured_at timestamptz not null, row_data jsonb not null,
 primary key(article_code,warehouse_number)
);
alter table public.workspace_mes_inventory_pending enable row level security;
revoke all on public.workspace_mes_inventory_pending from public,anon,authenticated;
grant all on public.workspace_mes_inventory_pending to service_role;
create or replace function public.apply_workspace_mes_inventory(
  p_event_id uuid, p_captured_at timestamptz, p_hash text, p_rows jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  row_value record;
  existing_hash text;
  total_stock numeric;
  total_committed numeric;
  total_available numeric;
begin
  perform pg_advisory_xact_lock(hashtext('workspace_shared_mes_inventory'));
  select payload_hash into existing_hash from workspace_mes_inventory_deliveries where event_id = p_event_id;
  if found then
    if existing_hash <> p_hash then raise exception 'INVENTORY_EVENT_CONFLICT'; end if;
    return jsonb_build_object('replay',true,'pendingArticles',(select count(distinct article_code) from workspace_mes_inventory_pending));
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 200
     or p_captured_at is null or p_captured_at > now() + interval '5 minutes' then
    raise exception 'INVALID_INVENTORY_SNAPSHOT';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(article_code text, warehouse_number int)
    group by article_code having count(*) <> 2 or count(distinct warehouse_number) <> 2
    or bool_or(warehouse_number not in (1,8))) then raise exception 'INCOMPLETE_INVENTORY_SNAPSHOT'; end if;

  for row_value in select distinct article_code from jsonb_to_recordset(p_rows) as x(article_code text) order by article_code loop
    -- Unknown catalog entries must be imported before their inventory can be delivered.
    if not exists (select 1 from ordini_prodotti_cache where codice_articolo = row_value.article_code) then
      insert into workspace_mes_inventory_pending(article_code,warehouse_number,captured_at,row_data)
      select x.article_code,x.warehouse_number,p_captured_at,to_jsonb(x)
      from jsonb_to_recordset(p_rows) as x(article_code text,warehouse_number int,unit_of_measure text,
        on_hand numeric,committed numeric,available numeric,unit_cost numeric)
      where x.article_code=row_value.article_code
      on conflict(article_code,warehouse_number) do update set captured_at=excluded.captured_at,row_data=excluded.row_data
        where excluded.captured_at >= workspace_mes_inventory_pending.captured_at;
      continue;
    end if;
    -- An older retry must never overwrite a newer delivered snapshot.
    if exists (select 1 from workspace_warehouse_stock where article_code = row_value.article_code
      and warehouse_number in (1,8) and source_payload->>'source_system' = 'ProgreMES'
      and synchronized_at > p_captured_at) then
      delete from workspace_mes_inventory_pending where article_code=row_value.article_code
       and captured_at <= (select max(synchronized_at) from workspace_warehouse_stock
         where article_code=row_value.article_code and warehouse_number in(1,8)
         and source_payload->>'source_system'='ProgreMES');
      continue;
    end if;
    insert into workspace_warehouse_stock (article_code, warehouse_number, warehouse_name, unit_of_measure,
      on_hand, committed, available, unit_cost, source_payload, synchronized_at, is_current)
    select x.article_code, x.warehouse_number, case x.warehouse_number when 8 then 'Magazzino c/Terzi' else 'Magazzino 1 Progrè' end,
      x.unit_of_measure, x.on_hand, x.committed, x.available, greatest(x.unit_cost,0),
      jsonb_build_object('source_system','ProgreMES','event_id',p_event_id), p_captured_at, true
    from jsonb_to_recordset(p_rows) as x(article_code text, warehouse_number int, unit_of_measure text,
      on_hand numeric, committed numeric, available numeric, unit_cost numeric)
    where x.article_code = row_value.article_code
    on conflict (article_code, warehouse_number) do update set
      on_hand=excluded.on_hand, committed=excluded.committed, available=excluded.available,
      unit_cost=excluded.unit_cost, unit_of_measure=excluded.unit_of_measure, source_payload=excluded.source_payload,
      synchronized_at=excluded.synchronized_at, sync_run_id=null, is_current=true;

    insert into workspace_warehouse_stock_history (snapshot_date, article_code, warehouse_number, warehouse_name,
      unit_of_measure, on_hand, committed, available, unit_cost, source, source_payload, captured_at)
    select (p_captured_at at time zone 'Europe/Rome')::date, article_code, warehouse_number, warehouse_name,
      unit_of_measure, on_hand, committed, available, unit_cost, 'mexal_progressive', source_payload, p_captured_at
    from workspace_warehouse_stock where article_code = row_value.article_code and warehouse_number in (1,8)
    on conflict (snapshot_date,article_code,warehouse_number) do update set
      on_hand=excluded.on_hand, committed=excluded.committed, available=excluded.available,
      unit_cost=excluded.unit_cost, source_payload=excluded.source_payload, captured_at=excluded.captured_at;

    delete from workspace_mes_inventory_pending where article_code=row_value.article_code and captured_at <= p_captured_at;
    -- Commercial IT/MKT availability remains scoped to warehouse 5.
    if row_value.article_code not ilike 'IT%' and row_value.article_code not ilike 'MKT%' then
      select sum(on_hand),sum(committed),sum(available) into total_stock,total_committed,total_available
      from workspace_warehouse_stock where article_code=row_value.article_code and warehouse_number in (1,8);
      update ordini_prodotti_cache set giacenza=total_stock, impegnato=total_committed,
        disponibilita=total_available, sincronizzato_il=p_captured_at where codice_articolo=row_value.article_code;
      update prodotti set giacenza=total_stock, disponibilita=total_available, ultimo_sync_mexal=p_captured_at
        where codice_mexal=row_value.article_code and sincronizzato_mexal=true;
    end if;
  end loop;
  insert into workspace_mes_inventory_deliveries(event_id,payload_hash,captured_at) values(p_event_id,p_hash,p_captured_at);
  return jsonb_build_object('applied',true,'pendingArticles',(select count(distinct article_code) from workspace_mes_inventory_pending));
end $$;

create function public.replay_workspace_mes_inventory_pending() returns jsonb
language plpgsql security definer set search_path=public as $$
declare pending record;
begin
 perform pg_advisory_xact_lock(hashtext('workspace_shared_mes_inventory'));
 for pending in
  select p.article_code,max(p.captured_at) as captured_at,jsonb_agg(p.row_data order by p.warehouse_number) as rows
  from workspace_mes_inventory_pending p join ordini_prodotti_cache c on c.codice_articolo=p.article_code
  group by p.article_code having count(*)=2 and min(p.captured_at)=max(p.captured_at)
 loop
  begin
   perform apply_workspace_mes_inventory(gen_random_uuid(),pending.captured_at,
    encode(sha256(convert_to(pending.rows::text,'UTF8')),'hex'),pending.rows);
  exception when others then
   raise warning 'MES inventory replay deferred for %: %',pending.article_code,SQLSTATE;
  end;
 end loop;
 return jsonb_build_object('pendingArticles',(select count(distinct article_code) from workspace_mes_inventory_pending));
end $$;
revoke all on function public.replay_workspace_mes_inventory_pending() from public,anon,authenticated;
grant execute on function public.replay_workspace_mes_inventory_pending() to service_role;

create function public.replay_mes_inventory_after_catalog() returns trigger
language plpgsql security definer set search_path=public as $$
declare pending record;
begin
 select max(captured_at) as captured_at,jsonb_agg(row_data order by warehouse_number) as rows into pending
 from workspace_mes_inventory_pending where article_code=new.codice_articolo
 having count(*)=2 and min(captured_at)=max(captured_at);
 if pending.rows is not null then
  perform apply_workspace_mes_inventory(gen_random_uuid(),pending.captured_at,
   encode(sha256(convert_to(pending.rows::text,'UTF8')),'hex'),pending.rows);
 end if;
 return new;
exception when others then
 -- Catalog imports retain their existing behavior even if replay is deferred.
 raise warning 'MES inventory replay deferred for %: %',new.codice_articolo,SQLSTATE;
 return new;
end $$;
revoke all on function public.replay_mes_inventory_after_catalog() from public,anon,authenticated;
create trigger replay_mes_inventory_catalog after insert or update of codice_articolo on public.ordini_prodotti_cache
 for each row when (pg_trigger_depth() = 0) execute function public.replay_mes_inventory_after_catalog();
commit;

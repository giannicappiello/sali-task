begin;

create table public.workspace_mes_inventory_deliveries (
  event_id uuid primary key,
  payload_hash text not null,
  captured_at timestamptz not null,
  received_at timestamptz not null default now()
);
alter table public.workspace_mes_inventory_deliveries enable row level security;
revoke all on public.workspace_mes_inventory_deliveries from public, anon, authenticated;
grant all on public.workspace_mes_inventory_deliveries to service_role;

-- One transaction publishes exactly the physical quantity and reservations used by MES.
create function public.apply_workspace_mes_inventory(
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
    return jsonb_build_object('replay', true);
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
      raise exception 'INVENTORY_ARTICLE_NOT_IMPORTED: %', row_value.article_code;
    end if;
    -- An older retry must never overwrite a newer delivered snapshot.
    if exists (select 1 from workspace_warehouse_stock where article_code = row_value.article_code
      and warehouse_number in (1,8) and source_payload->>'source_system' = 'ProgreMES'
      and synchronized_at > p_captured_at) then continue; end if;
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
  return jsonb_build_object('applied',true);
end $$;
revoke all on function public.apply_workspace_mes_inventory(uuid,timestamptz,text,jsonb) from public, anon, authenticated;
grant execute on function public.apply_workspace_mes_inventory(uuid,timestamptz,text,jsonb) to service_role;

create function public.protect_mes_inventory() returns trigger language plpgsql set search_path=public as $$
begin
  if old.source_payload->>'source_system' = 'ProgreMES' and
     (new.source_payload->>'source_system' is distinct from 'ProgreMES' or
      (tg_table_name='workspace_warehouse_stock' and to_jsonb(new)->>'is_current'='false')) then return old; end if;
  return new;
end $$;
create trigger protect_mes_current before update on public.workspace_warehouse_stock
  for each row execute function public.protect_mes_inventory();
create trigger protect_mes_history before update on public.workspace_warehouse_stock_history
  for each row execute function public.protect_mes_inventory();

create function public.align_mes_catalog_stock() returns trigger language plpgsql set search_path=public as $$
declare code text; stock numeric; reserved numeric; free numeric; captured timestamptz;
begin
  code := case when tg_table_name='prodotti' then to_jsonb(new)->>'codice_mexal' else to_jsonb(new)->>'codice_articolo' end;
  if code ilike 'IT%' or code ilike 'MKT%' then return new; end if;
  if (select count(*) from workspace_warehouse_stock where article_code=code and warehouse_number in (1,8)
      and source_payload->>'source_system'='ProgreMES') <> 2 then return new; end if;
  select sum(on_hand),sum(committed),sum(available),max(synchronized_at) into stock,reserved,free,captured
    from workspace_warehouse_stock where article_code=code and warehouse_number in (1,8);
  new.giacenza := stock; new.disponibilita := free;
  if tg_table_name='ordini_prodotti_cache' then new.impegnato:=reserved; new.sincronizzato_il:=captured;
  else new.ultimo_sync_mexal:=captured; end if;
  return new;
end $$;
create trigger align_mes_catalog before insert or update on public.ordini_prodotti_cache
  for each row execute function public.align_mes_catalog_stock();
create trigger align_mes_products before insert or update on public.prodotti
  for each row execute function public.align_mes_catalog_stock();

commit;

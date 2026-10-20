-- Source snapshots reference the existing product catalogue; they never create products.
-- Attach screens to the existing CRM module without restoring deleted modules or changing role grants.
insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
  select m.codice,s.codice,680,false,true from public.workspace_moduli m cross join public.workspace_schermate s
  where m.codice='crm_online' and m.attivo and s.attiva and s.codice in ('crm.online.ecommerce','crm.online.mailing')
  on conflict(modulo_codice,schermata_codice) do nothing;
alter table public.crm_external_connections add column if not exists import_state jsonb not null default '{}';
create table public.crm_external_products (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.crm_external_connections(id) on delete cascade,
  external_id text not null, marketplace text not null, external_sku text, asin text,
  parent_external_id text, nome text not null, currency text, price numeric(14,2), stock numeric(14,3), status text,
  assets jsonb not null default '[]', product_id uuid references public.prodotti(id) on delete set null,
  aggiornato_il timestamptz not null default now(), unique(connection_id,marketplace,external_id)
);
alter table public.crm_external_products enable row level security;
create policy "commerce products scoped read" on public.crm_external_products for select to authenticated
using(exists(select 1 from public.crm_external_connections c where c.id=connection_id
  and public.crm_row_visible(c.responsabile_id,c.reparto_id,'crm_online')));
grant select on public.crm_external_products to authenticated;
grant all on public.crm_external_products to service_role;

create or replace function public.crm_claim_commerce_import_service(target_connection_id uuid,target_triggered_by uuid)
returns uuid language plpgsql security definer set search_path=public as $$
begin
  if auth.role()<>'service_role' then raise exception 'Servizio riservato' using errcode='42501'; end if;
  perform 1 from public.crm_external_connections where id=target_connection_id for update;
  -- A killed server request must not leave the connection locked forever.
  update public.crm_sync_runs set status='failed',completed_at=now(),error_code='worker_interrupted',error_message='Importazione interrotta: cursore conservato'
    where connection_id=target_connection_id and sync_type='commerce_import' and status in ('running','queued','retrying')
      and coalesce(heartbeat_at,started_at,created_at)<now()-interval '15 minutes';
  return public.crm_claim_sync_run_service(target_connection_id,'commerce_import','incremental',gen_random_uuid()::text,target_triggered_by);
end $$;
revoke all on function public.crm_claim_commerce_import_service(uuid,uuid) from public,anon,authenticated;
grant execute on function public.crm_claim_commerce_import_service(uuid,uuid) to service_role;

-- The provider cursor and the entire page are committed in one transaction.
create or replace function public.crm_import_commerce_page_service(
  target_connection_id uuid, target_run_id uuid, expected_state jsonb,
  resource_kind text, page_rows jsonb, next_state jsonb
) returns void language plpgsql security definer set search_path=public as $$
declare c public.crm_external_connections; r jsonb; l jsonb; customer uuid; account uuid; order_pk uuid;
  product uuid; match_count integer; mapping public.crm_product_mappings;
begin
  if auth.role() <> 'service_role' then raise exception 'Servizio riservato' using errcode='42501'; end if;
  select * into strict c from public.crm_external_connections where id=target_connection_id for update;
  if not c.abilitata then raise exception 'Connessione disattivata'; end if;
  if c.import_state is distinct from expected_state then raise exception 'Cursore modificato: riprovare' using errcode='40001'; end if;
  if not exists(select 1 from public.crm_sync_runs where id=target_run_id and connection_id=c.id
    and sync_type='commerce_import' and status='running') then raise exception 'Lock importazione non valido'; end if;
  if resource_kind not in ('customers','orders','products') or jsonb_array_length(page_rows)>100 then raise exception 'Pagina non valida'; end if;
  for r in select value from jsonb_array_elements(page_rows) loop
    if resource_kind='customers' then
      insert into public.crm_external_customers(connection_id,external_id,email_hash,responsabile_id,reparto_id)
      values(c.id,r->>'external_id',r->>'email_hash',c.responsabile_id,c.reparto_id)
      on conflict(connection_id,external_id) do update set email_hash=excluded.email_hash,aggiornato_il=now()
      returning id,account_id into customer,account;
      if account is null then
        -- No automatic identity merge on email alone. Each source identity remains reviewable.
        insert into public.crm_accounts(tipo,nome,email,telefono,paese,fonte,responsabile_id,reparto_id,metadati)
        values('online',r->>'nome',r->>'email',r->>'telefono',r->>'paese',c.provider_code,c.responsabile_id,c.reparto_id,
          jsonb_build_object('connection_id',c.id,'external_id',r->>'external_id')) returning id into account;
        update public.crm_external_customers set account_id=account,identity_status='matched',identity_method='provider-id' where id=customer;
      end if;
      if r->'consent' is not null then
        insert into public.crm_marketing_consents(account_id,external_customer_id,purpose,status,legal_basis,source,captured_at,withdrawn_at,proof_reference,metadati_minimi,responsabile_id,reparto_id)
          select account,customer,r->'consent'->>'purpose',r->'consent'->>'status',
            case when r->'consent'->>'status'='granted' then 'consent' end,
            r->'consent'->>'source',(r->'consent'->>'captured_at')::timestamptz,(r->'consent'->>'withdrawn_at')::timestamptz,r->'consent'->>'proof_reference',
            jsonb_build_object('provider_status',r->'consent'->>'provider_status'),c.responsabile_id,c.reparto_id
          where not exists(select 1 from public.crm_marketing_consents mc where mc.external_customer_id=customer
            and mc.purpose=r->'consent'->>'purpose' and mc.source=r->'consent'->>'source'
            and mc.status=r->'consent'->>'status' and mc.captured_at is not distinct from (r->'consent'->>'captured_at')::timestamptz);
      end if;
    elsif resource_kind='products' then
      product:=null;
      if nullif(r->>'external_sku','') is not null then
        select * into mapping from public.crm_product_mappings where connection_id=c.id
          and marketplace=r->>'marketplace' and external_sku=r->>'external_sku';
        if found then
          if mapping.status='matched' then product:=mapping.product_id; end if;
        else
          select count(*),(array_agg(id))[1] into match_count,product from public.prodotti
          where codice_mexal=r->>'external_sku';
          if match_count<>1 then product:=null; end if;
          insert into public.crm_product_mappings(connection_id,marketplace,external_sku,asin,product_id,codice_mexal,status,match_method)
          values(c.id,r->>'marketplace',r->>'external_sku',r->>'asin',product,
            case when product is not null then r->>'external_sku' end,
            case when product is null then 'unmatched' else 'matched' end,'exact-sku');
        end if;
      end if;
      insert into public.crm_external_products(connection_id,external_id,marketplace,external_sku,asin,parent_external_id,nome,currency,price,stock,status,assets,product_id)
      values(c.id,r->>'external_id',r->>'marketplace',r->>'external_sku',r->>'asin',r->>'parent_external_id',r->>'nome',r->>'currency',
        (r->>'price')::numeric,(r->>'stock')::numeric,r->>'status',r->'assets',product)
      on conflict(connection_id,marketplace,external_id) do update set external_sku=excluded.external_sku,asin=excluded.asin,
        nome=excluded.nome,currency=excluded.currency,price=excluded.price,stock=excluded.stock,status=excluded.status,
        assets=excluded.assets,product_id=excluded.product_id,aggiornato_il=now();
      -- Fill missing catalogue images only; manually chosen images remain authoritative.
      if product is not null then
        update public.prodotti set immagine_catalogo_url=(select a->>'url' from jsonb_array_elements(r->'assets') a where a->>'type'='image' limit 1)
          where id=product and nullif(btrim(immagine_catalogo_url),'') is null and nullif(btrim(immagine_url),'') is null;
      end if;
    else
      customer:=null; account:=null;
      if r->'customer' is not null and r->'customer'<>'null'::jsonb then
        insert into public.crm_external_customers(connection_id,external_id,email_hash,responsabile_id,reparto_id)
        values(c.id,r->>'customer_external_id',r->'customer'->>'email_hash',c.responsabile_id,c.reparto_id)
        on conflict(connection_id,external_id) do nothing;
        select id,account_id into customer,account from public.crm_external_customers where connection_id=c.id and external_id=r->>'customer_external_id';
        if account is null then
          insert into public.crm_accounts(tipo,nome,email,telefono,paese,fonte,responsabile_id,reparto_id,metadati)
          values('online',r->'customer'->>'nome',r->'customer'->>'email',r->'customer'->>'telefono',r->'customer'->>'paese',c.provider_code,c.responsabile_id,c.reparto_id,
            jsonb_build_object('connection_id',c.id,'external_id',r->>'customer_external_id')) returning id into account;
          update public.crm_external_customers set account_id=account,identity_status='matched',identity_method='provider-guest-email' where id=customer;
        end if;
      end if;
      select id,account_id into customer,account from public.crm_external_customers
        where connection_id=c.id and external_id=r->>'customer_external_id';
      insert into public.crm_external_orders(connection_id,external_id,external_customer_id,account_id,marketplace,stato,ordered_at,currency,
        gross_revenue,discounts,refunds,fees,net_revenue,raw_summary,responsabile_id,reparto_id)
      values(c.id,r->>'external_id',customer,account,r->>'marketplace',r->>'stato',(r->>'ordered_at')::timestamptz,r->>'currency',
        (r->>'gross_revenue')::numeric,(r->>'discounts')::numeric,(r->>'refunds')::numeric,(r->>'fees')::numeric,
        (r->>'net_revenue')::numeric,r->'raw_summary',c.responsabile_id,c.reparto_id)
      on conflict(connection_id,external_id) do update set external_customer_id=excluded.external_customer_id,account_id=excluded.account_id,
        marketplace=excluded.marketplace,stato=excluded.stato,ordered_at=excluded.ordered_at,currency=excluded.currency,
        gross_revenue=excluded.gross_revenue,discounts=excluded.discounts,refunds=excluded.refunds,fees=excluded.fees,
        net_revenue=excluded.net_revenue,raw_summary=excluded.raw_summary,aggiornato_il=now() returning id into order_pk;
      delete from public.crm_external_order_lines where order_id=order_pk;
      for l in select value from jsonb_array_elements(r->'lines') loop
        product:=null;
        select product_id into product from public.crm_product_mappings where connection_id=c.id
          and marketplace=r->>'marketplace' and external_sku=l->>'external_sku' and status='matched';
        insert into public.crm_external_order_lines(order_id,external_line_id,external_sku,asin,product_id,quantity,unit_price,discount,line_revenue)
        values(order_pk,l->>'external_line_id',l->>'external_sku',l->>'asin',product,(l->>'quantity')::numeric,
          (l->>'unit_price')::numeric,(l->>'discount')::numeric,(l->>'line_revenue')::numeric);
      end loop;
    end if;
  end loop;
  update public.crm_external_customers ec set
    first_order_at=s.first_at,last_order_at=s.last_at,order_count=s.n,total_value=s.total
  from (select external_customer_id,min(ordered_at) first_at,max(ordered_at) last_at,count(*) n,sum(net_revenue) total
    from public.crm_external_orders where connection_id=c.id and external_customer_id is not null
      and lower(coalesce(stato,'')) not in ('cancelled','canceled','failed','pending','on-hold','pending_availability')
    group by external_customer_id) s where ec.id=s.external_customer_id;
  -- Listings are imported after Amazon orders: link their lines as mappings become available.
  if resource_kind='products' then
    update public.crm_external_order_lines l set product_id=m.product_id from public.crm_external_orders o,public.crm_product_mappings m
    where l.order_id=o.id and o.connection_id=c.id and m.connection_id=c.id and m.marketplace=o.marketplace
      and m.external_sku=l.external_sku and m.status='matched' and m.product_id is not null;
  end if;
  if resource_kind='orders' then
    delete from public.crm_external_metrics where connection_id=c.id and metadati->>'source'='commerce_import';
    insert into public.crm_external_metrics(connection_id,metric_date,channel,marketplace,orders,revenue,attribution_method,metadati,responsabile_id,reparto_id)
      select c.id,(ordered_at at time zone 'UTC')::date,c.tipo,marketplace,count(*),
        case when count(net_revenue)=count(*) then sum(net_revenue) end,'provider-reported',
        jsonb_build_object('source','commerce_import'),c.responsabile_id,c.reparto_id
      from public.crm_external_orders where connection_id=c.id
        and lower(coalesce(stato,'')) not in ('cancelled','canceled','failed','pending','on-hold','pending_availability')
      group by (ordered_at at time zone 'UTC')::date,marketplace;
  end if;
  update public.crm_external_connections set import_state=next_state,aggiornata_il=now() where id=c.id;
end $$;
revoke all on function public.crm_import_commerce_page_service(uuid,uuid,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.crm_import_commerce_page_service(uuid,uuid,jsonb,text,jsonb,jsonb) to service_role;

-- Incomplete monetary data must not silently lower revenue or AOV.
create or replace function public.crm_digital_dashboard(target_from date,target_to date,target_channel text default null,target_marketplace text default null)
returns jsonb language sql stable security invoker set search_path=public as $$
 with orders as (
  select o.* from public.crm_external_orders o join public.crm_external_connections c on c.id=o.connection_id
  where o.ordered_at>=target_from and o.ordered_at<target_to+1
    and lower(coalesce(o.stato,'')) not in ('cancelled','canceled','failed','pending','on-hold','pending_availability')
    and (target_channel is null or c.tipo=target_channel) and (target_marketplace is null or o.marketplace=target_marketplace)
 ), metrics as (
  select m.* from public.crm_external_metrics m where m.metric_date between target_from and target_to
    and (target_channel is null or m.channel=target_channel) and (target_marketplace is null or m.marketplace=target_marketplace)
 ) select jsonb_build_object(
  'revenue',case when count(orders.id)>0 and count(orders.net_revenue)=count(orders.id) then sum(orders.net_revenue) end,
  'orders',case when count(orders.id)>0 then count(orders.id) end,
  'customers',case when count(orders.account_id)>0 then count(distinct orders.account_id) end,
  'aov',case when count(orders.id)>0 and count(orders.net_revenue)=count(orders.id) then sum(orders.net_revenue)/count(orders.id) end,
  'marketingSpend',(select sum(spend) from metrics),
  'marketingRevenue',(select sum(revenue) from metrics where metadati->>'source' is distinct from 'commerce_import'),
  'roas',(select sum(revenue)/nullif(sum(spend),0) from metrics where metadati->>'source' is distinct from 'commerce_import'),
  'dataStatus',case when count(orders.id)=0 and (select count(*) from metrics)=0 then 'not_available'
    when count(orders.net_revenue)<count(orders.id) then 'partial' else 'available' end
 ) from orders;
$$;

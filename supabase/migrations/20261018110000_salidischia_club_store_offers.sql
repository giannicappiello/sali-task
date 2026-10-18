begin;
create table public.club_store_offers (
 id uuid primary key default gen_random_uuid(),store_code text not null references public.club_stores(store_code),
 title text not null check(length(btrim(title)) between 1 and 180),description text not null default '' check(length(description)<=4000),
 kind text not null check(kind in ('discount','bundle_gift','bundle_discount')),scope text not null default 'all' check(scope in ('all','category','product')),
 category_id integer references public.club_catalog_categories(id),product_id uuid references public.prodotti(id),
 discount_mode text not null default 'percent' check(discount_mode in ('percent','price')),sale_price numeric(12,2) check(sale_price>=0 and sale_price<=1000000 and sale_price<>'NaN'::numeric),discount_percent numeric(5,2),gift_product_id uuid references public.prodotti(id),gift_quantity integer not null default 1 check(gift_quantity between 1 and 99),
 status text not null default 'draft' check(status in ('draft','published','archived')),starts_at timestamptz not null default now(),ends_at timestamptz,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default clock_timestamp(),published_at timestamptz,
 check(ends_at is null or ends_at>starts_at),
 check((kind='bundle_gift' and gift_product_id is not null and discount_percent is null and sale_price is null and discount_mode='percent') or (kind in ('discount','bundle_discount') and gift_product_id is null and ((discount_mode='percent' and sale_price is null and discount_percent is not null and discount_percent>0 and discount_percent<=100 and discount_percent<>'NaN'::numeric) or (kind='discount' and discount_mode='price' and sale_price is not null and discount_percent is null)))),
 check((kind='discount' and ((scope='all' and category_id is null and product_id is null) or (scope='category' and category_id is not null and product_id is null) or (scope='product' and product_id is not null and category_id is null))) or (kind<>'discount' and scope='all' and category_id is null and product_id is null))
);
create index club_store_offers_visible_idx on public.club_store_offers(store_code,status,starts_at desc);
create table public.club_store_offer_requirements (
 offer_id uuid references public.club_store_offers(id) on delete cascade,product_id uuid references public.prodotti(id),quantity integer not null check(quantity between 1 and 99),primary key(offer_id,product_id)
);
create table public.club_store_offer_events (
 id uuid primary key default gen_random_uuid(),offer_id uuid not null references public.club_store_offers(id),actor_id uuid not null references auth.users(id),
 action text not null,snapshot jsonb not null,created_at timestamptz not null default now()
);
do $$declare t text;begin
 foreach t in array array['club_store_offers','club_store_offer_requirements','club_store_offer_events'] loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

create function public.club_viewer_store() returns text language sql stable security definer set search_path=public as $$
 select coalesce(public.club_store_code(),(select m.trusted_store_code from public.club_members m join public.club_stores s on s.store_code=m.trusted_store_code join public.ordini_clienti_cache c on c.codice_cliente=s.store_code where m.auth_user_id=auth.uid() and m.active and s.enabled and c.attivo_mexal is not false));
$$;
create function public.club_offer_editor_store(target_store_code text default null,required_level text default 'lettura') returns text language plpgsql stable security definer set search_path=public as $$
declare store text;begin
 if public.workspace_internal_user() and not public.club_external_identity() then
  perform public.club_require_staff('negozi',required_level);
  if target_store_code is null or target_store_code not in(select public.club_staff_store_codes()) or (required_level<>'lettura' and not exists(select 1 from public.club_stores where store_code=target_store_code)) then raise exception 'Negozio non disponibile nel tuo ambito Workspace.' using errcode='42501';end if;return target_store_code;
 end if;
 perform public.club_verified_identity();store:=public.club_store_code();
 if store is null then raise exception 'Accesso negozio non attivo.' using errcode='42501';end if;
 if target_store_code is not null and target_store_code<>store then raise exception 'Puoi gestire solo le offerte del tuo negozio.' using errcode='42501';end if;return store;
end $$;
-- The public reference is Mexal list price 1 exactly as synchronized.
-- Do not add VAT or infer another customer-facing price list.
create function public.club_list_price(p public.prodotti) returns numeric language plpgsql immutable as $$
declare price numeric;begin
 price:=nullif(to_jsonb(p)->>'prezzo_listino','')::numeric;
 if price>0 and price<=1000000 and price<>'NaN'::numeric then return round(price,2);end if;return null;
end $$;
create function public.club_product_in_category(target_product_id uuid,target_category_id integer) returns boolean language sql stable security definer set search_path=public as $$
 with recursive descendants(id) as(select id from public.club_catalog_categories where id=target_category_id and active union select c.id from public.club_catalog_categories c join descendants d on c.parent_id=d.id where c.active)
 select exists(select 1 from public.club_catalog_product_categories pc where pc.product_id=target_product_id and pc.category_id in(select id from descendants));
$$;
create function public.club_offer_product_available(target_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.prodotti p join public.club_catalog_products c on c.product_id=p.id where p.id=target_id and c.visible and public.club_catalog_eligible(p));
$$;
create function public.club_active_store_offers(target_store text) returns setof public.club_store_offers language sql stable security definer set search_path=public as $$
 select o.* from public.club_store_offers o join public.club_stores s on s.store_code=o.store_code join public.ordini_clienti_cache c on c.codice_cliente=s.store_code
 where o.store_code=target_store and o.status='published' and o.starts_at<=now() and (o.ends_at is null or o.ends_at>now()) and s.enabled and c.attivo_mexal is not false
 and (o.product_id is null or public.club_offer_product_available(o.product_id)) and (o.gift_product_id is null or public.club_offer_product_available(o.gift_product_id))
 and (o.category_id is null or exists(select 1 from public.club_catalog_categories where id=o.category_id and active))
 and not exists(select 1 from public.club_store_offer_requirements r where r.offer_id=o.id and not public.club_offer_product_available(r.product_id));
$$;
create function public.club_store_offer_json(target_id uuid,editor boolean default false) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',o.id,'store_code',o.store_code,'store_name',c.ragione_sociale,'title',o.title,'description',o.description,'kind',o.kind,'scope',o.scope,'category_id',o.category_id,'category_name',cat.name,
 'product_id',o.product_id,'product_name',cp.display_name,'discount_percent',o.discount_percent,'discount_mode',o.discount_mode,'sale_price',o.sale_price,'gift_product_id',o.gift_product_id,'gift_name',gp.display_name,'gift_quantity',o.gift_quantity,'starts_at',o.starts_at,'ends_at',o.ends_at,
 'requirements',coalesce((select jsonb_agg(jsonb_build_object('product_id',r.product_id,'name',rc.display_name,'quantity',r.quantity) order by rc.display_name,r.product_id) from public.club_store_offer_requirements r join public.club_catalog_products rc on rc.product_id=r.product_id where r.offer_id=o.id),'[]'))
 ||case when editor then jsonb_build_object('status',o.status,'updated_at',o.updated_at) else '{}'::jsonb end
 from public.club_store_offers o join public.ordini_clienti_cache c on c.codice_cliente=o.store_code left join public.club_catalog_categories cat on cat.id=o.category_id
 left join public.club_catalog_products cp on cp.product_id=o.product_id left join public.club_catalog_products gp on gp.product_id=o.gift_product_id where o.id=target_id;
$$;
create function public.club_product_pricing(target_id uuid,target_store text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare price numeric;final_price numeric;percent numeric:=0;offer_id uuid;price_mode text;offers jsonb;begin
 select public.club_list_price(p) into price from public.prodotti p where p.id=target_id;
 select candidate,o.id,o.discount_mode into final_price,offer_id,price_mode from public.club_active_store_offers(target_store)o cross join lateral(select case when o.discount_mode='price' then o.sale_price else round(price*(1-o.discount_percent/100),2) end as candidate)x
 where o.kind='discount' and (o.scope='all' or o.product_id=target_id or (o.scope='category' and public.club_product_in_category(target_id,o.category_id))) and candidate is not null order by candidate,o.starts_at desc,o.id limit 1;
 final_price:=coalesce(final_price,price);percent:=case when price>0 and final_price<price then round(100*(1-final_price/price),2) else 0 end;
 select coalesce(jsonb_agg(public.club_store_offer_json(o.id) order by o.starts_at desc,o.id),'[]') into offers from public.club_active_store_offers(target_store)o where
 (o.kind='discount' and (o.scope='all' or o.product_id=target_id or (o.scope='category' and public.club_product_in_category(target_id,o.category_id))))
 or (o.kind<>'discount' and (o.gift_product_id=target_id or exists(select 1 from public.club_store_offer_requirements r where r.offer_id=o.id and r.product_id=target_id)));
 return jsonb_build_object('list_price',price,'price',final_price,'discount_percent',percent,'offer_id',offer_id,'price_mode',price_mode,'store_code',target_store,'store_name',(select ragione_sociale from public.ordini_clienti_cache where codice_cliente=target_store),'offers',offers);
end $$;
alter function public.club_catalog_product_json(uuid,boolean) rename to club_catalog_product_base_json;
create function public.club_catalog_product_json(target_id uuid,full_text boolean default false) returns jsonb language sql stable security definer set search_path=public as $$
 select public.club_catalog_product_base_json(target_id,full_text)||jsonb_build_object('pricing',public.club_product_pricing(target_id,public.club_viewer_store()));
$$;
create function public.club_shop_offers(page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare store text:=public.club_viewer_store();begin
 if page_offset<0 then raise exception 'Pagina non valida.';end if;
 return jsonb_build_object('store_code',store,'store_name',(select ragione_sociale from public.ordini_clienti_cache where codice_cliente=store),'total',(select count(*) from public.club_active_store_offers(store)),
 'rows',coalesce((select jsonb_agg(public.club_store_offer_json(id) order by starts_at desc,id) from(select id,starts_at from public.club_active_store_offers(store) order by starts_at desc,id limit 12 offset page_offset)x),'[]'));
end $$;
create function public.club_my_store_offers(page_offset integer default 0,target_store_code text default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare store text:=public.club_offer_editor_store(target_store_code);begin
 if page_offset<0 then raise exception 'Pagina non valida.';end if;
 return jsonb_build_object('store_code',store,'store_name',(select ragione_sociale from public.ordini_clienti_cache where codice_cliente=store),'total',(select count(*) from public.club_store_offers where store_code=store),
 'rows',coalesce((select jsonb_agg(public.club_store_offer_json(id,true) order by created_at desc,id) from(select id,created_at from public.club_store_offers where store_code=store order by created_at desc,id limit 20 offset page_offset)x),'[]'));
end $$;
create function public.club_store_offer_editor(target_id uuid,target_store_code text default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare store text:=public.club_offer_editor_store(target_store_code);begin
 if not exists(select 1 from public.club_store_offers where id=target_id and store_code=store) then raise exception 'Offerta non disponibile per questo negozio.' using errcode='42501';end if;return public.club_store_offer_json(target_id,true);
end $$;
create function public.club_save_store_offer(payload jsonb,target_id uuid default null,expected_updated_at timestamptz default null,target_store_code text default null) returns uuid language plpgsql security definer set search_path=public as $$
declare store text:=public.club_offer_editor_store(target_store_code,'scrittura');row public.club_store_offers;saved_offer_id uuid:=coalesce(target_id,gen_random_uuid());req jsonb:=coalesce(payload->'requirements','[]');begin
 if target_id is not null then
  select * into row from public.club_store_offers where id=target_id and store_code=store for update;
  if not found then raise exception 'Offerta non disponibile per questo negozio.' using errcode='42501';end if;
  if row.status='published' then raise exception 'Duplica l’offerta pubblicata per creare una nuova bozza.';end if;
  if expected_updated_at is null or row.updated_at<>expected_updated_at then raise exception 'L’offerta è cambiata. Ricarica prima di salvare.' using errcode='40001';end if;
 end if;
 if payload->>'kind' in ('bundle_gift','bundle_discount') then
  if jsonb_typeof(req)<>'array' or jsonb_array_length(req) not between 1 and 20 then raise exception 'Seleziona da 1 a 20 prodotti richiesti dall’offerta.';end if;
  if exists(select 1 from jsonb_to_recordset(req)as r(product_id uuid,quantity integer) where not public.club_offer_product_available(r.product_id) or quantity is null or quantity not between 1 and 99) then raise exception 'Controlla i prodotti richiesti e le quantità.';end if;
  if (select count(distinct r.product_id) from jsonb_to_recordset(req)as r(product_id uuid,quantity integer))<>jsonb_array_length(req) then raise exception 'Un prodotto compare più volte nelle condizioni.';end if;
 else req:='[]';end if;
 if nullif(payload->>'product_id','') is not null and not public.club_offer_product_available((payload->>'product_id')::uuid) then raise exception 'Prodotto non disponibile nel catalogo Club.';end if;
 if nullif(payload->>'gift_product_id','') is not null and not public.club_offer_product_available((payload->>'gift_product_id')::uuid) then raise exception 'Prodotto omaggio non disponibile nel catalogo Club.';end if;
 insert into public.club_store_offers(id,store_code,title,description,kind,scope,category_id,product_id,discount_mode,sale_price,discount_percent,gift_product_id,gift_quantity,starts_at,ends_at,created_by,updated_at)
 values(saved_offer_id,store,btrim(payload->>'title'),coalesce(payload->>'description',''),payload->>'kind',coalesce(payload->>'scope','all'),nullif(payload->>'category_id','')::integer,nullif(payload->>'product_id','')::uuid,coalesce(payload->>'discount_mode','percent'),nullif(payload->>'sale_price','')::numeric,nullif(payload->>'discount_percent','')::numeric,nullif(payload->>'gift_product_id','')::uuid,coalesce((payload->>'gift_quantity')::integer,1),coalesce(nullif(payload->>'starts_at','')::timestamptz,now()),nullif(payload->>'ends_at','')::timestamptz,auth.uid(),clock_timestamp())
 on conflict(id) do update set title=excluded.title,description=excluded.description,kind=excluded.kind,scope=excluded.scope,category_id=excluded.category_id,product_id=excluded.product_id,discount_mode=excluded.discount_mode,sale_price=excluded.sale_price,discount_percent=excluded.discount_percent,gift_product_id=excluded.gift_product_id,gift_quantity=excluded.gift_quantity,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status='draft',updated_at=excluded.updated_at;
 delete from public.club_store_offer_requirements r where r.offer_id=saved_offer_id;
 insert into public.club_store_offer_requirements select saved_offer_id,r.product_id,r.quantity from jsonb_to_recordset(req)as r(product_id uuid,quantity integer);
 insert into public.club_store_offer_events(offer_id,actor_id,action,snapshot) values(saved_offer_id,auth.uid(),'draft_saved',public.club_store_offer_json(saved_offer_id,true));return saved_offer_id;
end $$;
create function public.club_publish_store_offer(target_id uuid,expected_updated_at timestamptz,archive boolean default false,target_store_code text default null) returns void language plpgsql security definer set search_path=public as $$
declare store text:=public.club_offer_editor_store(target_store_code,'scrittura');row public.club_store_offers;begin
 select * into row from public.club_store_offers where id=target_id and store_code=store for update;
 if not found then raise exception 'Offerta non disponibile per questo negozio.' using errcode='42501';end if;
 if expected_updated_at is null or row.updated_at<>expected_updated_at then raise exception 'L’offerta è cambiata. Ricarica prima di pubblicare.' using errcode='40001';end if;
 if not archive and row.status<>'draft' then raise exception 'Puoi pubblicare soltanto una bozza.';end if;
 if not archive and ((row.product_id is not null and not public.club_offer_product_available(row.product_id)) or (row.gift_product_id is not null and not public.club_offer_product_available(row.gift_product_id)) or exists(select 1 from public.club_store_offer_requirements r where r.offer_id=target_id and not public.club_offer_product_available(r.product_id))) then raise exception 'Uno dei prodotti non è più disponibile.';end if;
 update public.club_store_offers set status=case when archive then 'archived' else 'published' end,published_at=case when archive then published_at else now() end,updated_at=clock_timestamp() where id=target_id;
 insert into public.club_store_offer_events(offer_id,actor_id,action,snapshot) values(target_id,auth.uid(),case when archive then 'archived' else 'published' end,public.club_store_offer_json(target_id,true));
end $$;
create function public.club_quote_store_offer(target_id uuid,items jsonb) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare store text:=public.club_viewer_store();offer public.club_store_offers;missing jsonb;lines jsonb;begin
 perform public.club_verified_identity();
 select * into offer from public.club_active_store_offers(store) where id=target_id;
 if not found then raise exception 'Offerta non disponibile dal tuo negozio di fiducia.' using errcode='42501';end if;
 if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items)>50 then raise exception 'Elenco prodotti non valido.';end if;
 if exists(select 1 from jsonb_to_recordset(items)as x(product_id uuid,quantity numeric) where x.quantity is null or x.quantity<0 or x.quantity>1000 or x.quantity='NaN'::numeric or not public.club_offer_product_available(x.product_id)) then raise exception 'Controlla prodotti e quantità.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('product_id',r.product_id,'name',c.display_name,'required',r.quantity,'selected',coalesce(x.quantity,0))),'[]') into missing
 from public.club_store_offer_requirements r join public.club_catalog_products c on c.product_id=r.product_id left join(select product_id,sum(quantity) as quantity from jsonb_to_recordset(items)as x(product_id uuid,quantity numeric) group by product_id)x on x.product_id=r.product_id where r.offer_id=target_id and coalesce(x.quantity,0)<r.quantity;
 select coalesce(jsonb_agg(jsonb_build_object('product_id',p.id,'name',c.display_name,'quantity',x.quantity,'list_price',public.club_list_price(p),'base_price',(pricing->>'price')::numeric,
 'price',case when offer.kind='bundle_discount' and jsonb_array_length(missing)=0 and exists(select 1 from public.club_store_offer_requirements r where r.offer_id=offer.id and r.product_id=p.id) then round((pricing->>'price')::numeric*(1-offer.discount_percent/100),2) else (pricing->>'price')::numeric end) order by c.display_name),'[]') into lines
 from(select product_id,sum(quantity) as quantity from jsonb_to_recordset(items)as x(product_id uuid,quantity numeric) group by product_id)x join public.prodotti p on p.id=x.product_id join public.club_catalog_products c on c.product_id=p.id cross join lateral(select public.club_product_pricing(p.id,store) as pricing)y;
 return jsonb_build_object('qualifies',jsonb_array_length(missing)=0,'missing',missing,'lines',lines,'offer',public.club_store_offer_json(target_id),'gift',case when offer.kind='bundle_gift' and jsonb_array_length(missing)=0 then jsonb_build_object('product_id',offer.gift_product_id,'name',(select display_name from public.club_catalog_products where product_id=offer.gift_product_id),'quantity',offer.gift_quantity) else null end);
end $$;

do $$declare f record;begin
 for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('club_viewer_store','club_offer_editor_store','club_list_price','club_product_in_category','club_offer_product_available','club_active_store_offers','club_store_offer_json','club_product_pricing','club_catalog_product_json','club_shop_offers','club_my_store_offers','club_store_offer_editor','club_save_store_offer','club_publish_store_offer','club_quote_store_offer') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.proname='club_shop_offers' then execute format('grant execute on function %s to anon,authenticated',f.signature);
  elsif f.proname in ('club_my_store_offers','club_store_offer_editor','club_save_store_offer','club_publish_store_offer','club_quote_store_offer') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
do $$declare original text;revised text;begin
 select pg_get_functiondef('public.club_api_boundary()'::regprocedure) into original;
 revised:=replace(original,'''/rpc/club_public_info''','''/rpc/club_public_info'',''/rpc/club_shop_offers'',''/rpc/club_my_store_offers'',''/rpc/club_store_offer_editor'',''/rpc/club_save_store_offer'',''/rpc/club_publish_store_offer'',''/rpc/club_quote_store_offer''');
 if revised=original then raise exception 'Unexpected Club API boundary.';end if;execute revised;
end $$;
notify pgrst,'reload schema';
commit;

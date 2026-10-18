begin;
alter table public.club_store_offers add column combination_mode text not null default 'best' check(combination_mode in ('best','stack','replace'));
create or replace function public.club_store_offer_json(target_id uuid,editor boolean default false) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',o.id,'store_code',o.store_code,'store_name',c.ragione_sociale,'title',o.title,'description',o.description,'kind',o.kind,'scope',o.scope,'category_id',o.category_id,'category_name',cat.name,
 'combination_mode',o.combination_mode,'published_at',o.published_at,'product_id',o.product_id,'product_name',cp.display_name,'discount_percent',o.discount_percent,'discount_mode',o.discount_mode,'sale_price',o.sale_price,'gift_product_id',o.gift_product_id,'gift_name',gp.display_name,'gift_quantity',o.gift_quantity,'starts_at',o.starts_at,'ends_at',o.ends_at,
 'requirements',coalesce((select jsonb_agg(jsonb_build_object('product_id',r.product_id,'name',rc.display_name,'quantity',r.quantity) order by rc.display_name,r.product_id) from public.club_store_offer_requirements r join public.club_catalog_products rc on rc.product_id=r.product_id where r.offer_id=o.id),'[]'))
 ||case when editor then jsonb_build_object('status',o.status,'updated_at',o.updated_at) else '{}'::jsonb end
 from public.club_store_offers o join public.ordini_clienti_cache c on c.codice_cliente=o.store_code left join public.club_catalog_categories cat on cat.id=o.category_id
 left join public.club_catalog_products cp on cp.product_id=o.product_id left join public.club_catalog_products gp on gp.product_id=o.gift_product_id where o.id=target_id;
$$;
create or replace function public.club_save_store_offer(payload jsonb,target_id uuid default null,expected_updated_at timestamptz default null,target_store_code text default null) returns uuid language plpgsql security definer set search_path=public as $$
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
 insert into public.club_store_offers(id,store_code,title,description,kind,scope,category_id,product_id,combination_mode,discount_mode,sale_price,discount_percent,gift_product_id,gift_quantity,starts_at,ends_at,created_by,updated_at)
 values(saved_offer_id,store,btrim(payload->>'title'),coalesce(payload->>'description',''),payload->>'kind',coalesce(payload->>'scope','all'),nullif(payload->>'category_id','')::integer,nullif(payload->>'product_id','')::uuid,coalesce(payload->>'combination_mode','best'),coalesce(payload->>'discount_mode','percent'),nullif(payload->>'sale_price','')::numeric,nullif(payload->>'discount_percent','')::numeric,nullif(payload->>'gift_product_id','')::uuid,coalesce((payload->>'gift_quantity')::integer,1),coalesce(nullif(payload->>'starts_at','')::timestamptz,now()),nullif(payload->>'ends_at','')::timestamptz,auth.uid(),clock_timestamp())
 on conflict(id) do update set title=excluded.title,description=excluded.description,kind=excluded.kind,scope=excluded.scope,category_id=excluded.category_id,product_id=excluded.product_id,combination_mode=excluded.combination_mode,discount_mode=excluded.discount_mode,sale_price=excluded.sale_price,discount_percent=excluded.discount_percent,gift_product_id=excluded.gift_product_id,gift_quantity=excluded.gift_quantity,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status='draft',updated_at=excluded.updated_at;
 delete from public.club_store_offer_requirements r where r.offer_id=saved_offer_id;
 insert into public.club_store_offer_requirements select saved_offer_id,r.product_id,r.quantity from jsonb_to_recordset(req)as r(product_id uuid,quantity integer);
 insert into public.club_store_offer_events(offer_id,actor_id,action,snapshot) values(saved_offer_id,auth.uid(),'draft_saved',public.club_store_offer_json(saved_offer_id,true));return saved_offer_id;
end $$;

-- Shared server calculation for catalog prices and basket simulations.
create or replace function public.club_offer_applies(o public.club_store_offers,target_product uuid) returns boolean language sql stable security definer set search_path=public as $$
 select case when o.kind='discount' then o.scope='all' or o.product_id=target_product or (o.scope='category' and public.club_product_in_category(target_product,o.category_id))
 else o.gift_product_id=target_product or exists(select 1 from public.club_store_offer_requirements r where r.offer_id=o.id and r.product_id=target_product) end;
$$;
create or replace function public.club_offer_qualifies(target_offer uuid,items jsonb) returns boolean language sql stable security definer set search_path=public as $$
 select not exists(select 1 from public.club_store_offer_requirements r left join
 (select product_id,sum(quantity) quantity from jsonb_to_recordset(items) x(product_id uuid,quantity numeric) group by product_id) x on x.product_id=r.product_id
 where r.offer_id=target_offer and coalesce(x.quantity,0)<r.quantity);
$$;
create or replace function public.club_combined_product_price(target_product uuid,target_store text,items jsonb default null,quote_target uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare list_price numeric;price numeric;candidate numeric;o public.club_store_offers;applied jsonb:='[]';mode text;last_id uuid;begin
 select public.club_list_price(p) into list_price from public.prodotti p where p.id=target_product;
 price:=list_price;
 -- Existing promotions retain the former best-price behavior until recreated.
 select x.candidate,a.id,a.discount_mode into candidate,last_id,mode from public.club_active_store_offers(target_store) a
 cross join lateral(select case when a.discount_mode='price' then a.sale_price else round(list_price*(1-a.discount_percent/100),2) end candidate)x
 where a.combination_mode='best' and a.kind='discount' and public.club_offer_applies(a,target_product) and x.candidate is not null order by x.candidate,a.published_at,a.id limit 1;
 if candidate is not null then price:=candidate;applied:=jsonb_build_array(last_id);end if;
 for o in select a.* from public.club_active_store_offers(target_store) a where public.club_offer_applies(a,target_product)
 and (a.kind='discount' or (items is not null and public.club_offer_qualifies(a.id,items)))
 and (a.combination_mode<>'best' or (a.kind<>'discount' and a.id=quote_target)) order by a.published_at,a.id loop
  if o.combination_mode='replace' then price:=list_price;applied:='[]';mode:=null;last_id:=null;end if;
  if o.kind='discount' and o.discount_mode='price' then
   price:=case when o.combination_mode='stack' and price is not null then least(price,o.sale_price) else o.sale_price end;mode:='price';last_id:=o.id;
  elsif o.kind in ('discount','bundle_discount') and (o.kind='discount' or exists(select 1 from public.club_store_offer_requirements r where r.offer_id=o.id and r.product_id=target_product)) then
   price:=round(price*(1-o.discount_percent/100),2);mode:='percent';last_id:=o.id;
  end if;
  applied:=applied||jsonb_build_array(o.id);
 end loop;
 return jsonb_build_object('price',price,'list_price',list_price,'price_mode',mode,'offer_id',last_id,'applied_offer_ids',applied);
end $$;
create or replace function public.club_product_pricing(target_id uuid,target_store text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare pricing jsonb:=public.club_combined_product_price(target_id,target_store);price numeric:=(pricing->>'list_price')::numeric;final_price numeric:=(pricing->>'price')::numeric;offers jsonb;begin
 select coalesce(jsonb_agg(public.club_store_offer_json(o.id) order by o.published_at,o.id),'[]') into offers from public.club_active_store_offers(target_store)o where public.club_offer_applies(o,target_id);
 return pricing||jsonb_build_object('discount_percent',case when price>0 and final_price<price then round(100*(1-final_price/price),2) else 0 end,'store_code',target_store,'store_name',(select ragione_sociale from public.ordini_clienti_cache where codice_cliente=target_store),'offers',offers);
end $$;
create or replace function public.club_quote_store_offer(target_id uuid,items jsonb) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare store text:=public.club_viewer_store();offer public.club_store_offers;missing jsonb;lines jsonb;gifts jsonb;gift jsonb;begin
 perform public.club_verified_identity();
 select * into offer from public.club_active_store_offers(store) where id=target_id;
 if not found then raise exception 'Offerta non disponibile dal tuo negozio di fiducia.' using errcode='42501';end if;
 if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items)>50 then raise exception 'Elenco prodotti non valido.';end if;
 if exists(select 1 from jsonb_to_recordset(items)as x(product_id uuid,quantity numeric) where x.quantity is null or x.quantity<0 or x.quantity>1000 or x.quantity='NaN'::numeric or not public.club_offer_product_available(x.product_id)) then raise exception 'Controlla prodotti e quantità.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('product_id',r.product_id,'name',c.display_name,'required',r.quantity,'selected',coalesce(x.quantity,0))),'[]') into missing
 from public.club_store_offer_requirements r join public.club_catalog_products c on c.product_id=r.product_id left join(select product_id,sum(quantity) as quantity from jsonb_to_recordset(items)as x(product_id uuid,quantity numeric) group by product_id)x on x.product_id=r.product_id where r.offer_id=target_id and coalesce(x.quantity,0)<r.quantity;
 select coalesce(jsonb_agg(jsonb_build_object('product_id',p.id,'name',c.display_name,'quantity',x.quantity,'list_price',pricing->'list_price','base_price',public.club_product_pricing(p.id,store)->'price','price',pricing->'price','applied_offer_ids',pricing->'applied_offer_ids') order by c.display_name),'[]') into lines
 from(select product_id,sum(quantity) as quantity from jsonb_to_recordset(items)as x(product_id uuid,quantity numeric) group by product_id)x join public.prodotti p on p.id=x.product_id join public.club_catalog_products c on c.product_id=p.id cross join lateral(select public.club_combined_product_price(p.id,store,items,target_id) pricing)y;
 select coalesce(jsonb_agg(jsonb_build_object('offer_id',a.id,'product_id',a.gift_product_id,'name',c.display_name,'quantity',a.gift_quantity) order by a.published_at,a.id),'[]') into gifts
 from public.club_active_store_offers(store)a join public.club_catalog_products c on c.product_id=a.gift_product_id
 where a.kind='bundle_gift' and (a.combination_mode<>'best' or a.id=target_id) and public.club_offer_qualifies(a.id,items)
 and not exists(select 1 from public.club_store_offer_requirements r where r.offer_id=a.id and not (public.club_combined_product_price(r.product_id,store,items,target_id)->'applied_offer_ids') @> jsonb_build_array(a.id));
 select value into gift from jsonb_array_elements(gifts) where value->>'offer_id'=target_id::text;
 return jsonb_build_object('qualifies',jsonb_array_length(missing)=0,'missing',missing,'lines',lines,'offer',public.club_store_offer_json(target_id),'gift',gift,'gifts',gifts);
end $$;
revoke all on function public.club_offer_applies(public.club_store_offers,uuid),public.club_offer_qualifies(uuid,jsonb),public.club_combined_product_price(uuid,text,jsonb,uuid) from public,anon,authenticated;
create or replace function public.club_publish_store_offer(target_id uuid,expected_updated_at timestamptz,archive boolean default false,target_store_code text default null) returns void language plpgsql security definer set search_path=public as $$
declare store text:=public.club_offer_editor_store(target_store_code,'scrittura');row public.club_store_offers;begin
 select * into row from public.club_store_offers where id=target_id and store_code=store for update;
 if not found then raise exception 'Offerta non disponibile per questo negozio.' using errcode='42501';end if;
 if expected_updated_at is null or row.updated_at<>expected_updated_at then raise exception 'L’offerta è cambiata. Ricarica prima di pubblicare.' using errcode='40001';end if;
 if not archive and row.status<>'draft' then raise exception 'Puoi pubblicare soltanto una bozza.';end if;
 if not archive and ((row.product_id is not null and not public.club_offer_product_available(row.product_id)) or (row.gift_product_id is not null and not public.club_offer_product_available(row.gift_product_id)) or exists(select 1 from public.club_store_offer_requirements r where r.offer_id=target_id and not public.club_offer_product_available(r.product_id))) then raise exception 'Uno dei prodotti non è più disponibile.';end if;
 update public.club_store_offers set status=case when archive then 'archived' else 'published' end,published_at=case when archive then published_at else clock_timestamp() end,updated_at=clock_timestamp() where id=target_id;
 insert into public.club_store_offer_events(offer_id,actor_id,action,snapshot) values(target_id,auth.uid(),case when archive then 'archived' else 'published' end,public.club_store_offer_json(target_id,true));
end $$;
notify pgrst,'reload schema';
commit;

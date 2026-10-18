begin;
alter table public.club_rewards add column product_scope text not null default 'products' check(product_scope in ('all','categories','products'));
alter table public.club_rewards add column product_ids uuid[] not null default '{}';
alter table public.club_rewards add column category_ids integer[] not null default '{}';
update public.club_rewards set product_ids=array[product_id] where kind='products' and product_id is not null;
do $$declare constraint_name text;begin
 for constraint_name in select conname from pg_constraint where conrelid='public.club_rewards'::regclass and contype='c' and pg_get_constraintdef(oid) like '%product_id IS NOT NULL%' loop
  execute format('alter table public.club_rewards drop constraint %I',constraint_name);
 end loop;
end $$;
alter table public.club_rewards add constraint club_reward_scope_check check(
 (kind='prizes' and product_id is null and cardinality(product_ids)=0 and cardinality(category_ids)=0)
 or (kind='products' and (
  (product_scope='all' and product_id is null and cardinality(product_ids)=0 and cardinality(category_ids)=0)
  or (product_scope='categories' and product_id is null and cardinality(product_ids)=0 and cardinality(category_ids)>0)
  or (product_scope='products' and cardinality(product_ids)>0 and cardinality(category_ids)=0 and (product_id is null or product_id=any(product_ids)))
 )));

create function public.club_reward_eligible_products(target_reward_id uuid)
returns table(product_id uuid,name text,code text) language sql stable security definer set search_path=public as $$
 with recursive selected_categories(id) as (
 select c.id from club_catalog_categories c join club_rewards r on r.id=target_reward_id where c.active and c.id=any(r.category_ids)
 union select c.id from club_catalog_categories c join selected_categories parent on parent.id=c.parent_id where c.active
 )
 select p.id,p.nome,p.codice_mexal from prodotti p cross join club_rewards r
 where r.id=target_reward_id and r.kind='products' and p.attivo_mexal is true and p.mostra_in_app is true
 and upper(btrim(coalesce(p.codice_mexal,''))) like 'IT%'
 and (r.product_scope='all' or (r.product_scope='products' and p.id=any(r.product_ids))
 or (r.product_scope='categories' and exists(select 1 from club_catalog_product_categories pc join selected_categories c on c.id=pc.category_id where pc.product_id=p.id)));
$$;
revoke all on function public.club_reward_eligible_products(uuid) from public,anon,authenticated;

create or replace function public.club_save_reward(payload jsonb,target_id uuid default null,expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare reward_id uuid;current_row club_rewards;scope text;products uuid[]:='{}';categories integer[]:='{}';begin
 perform club_require_staff('premi','scrittura');
 if target_id is not null then
  select * into current_row from club_rewards where id=target_id for update;
  if not found then raise exception 'Premio non trovato.';end if;
  if expected_updated_at is null or current_row.updated_at<>expected_updated_at then raise exception 'Premio modificato da un altro operatore. Ricarica.' using errcode='40001';end if;
 end if;
 scope:=coalesce(payload->>'product_scope','products');
 if payload->>'kind'='products' then
  if scope not in ('all','categories','products') then raise exception 'Selezione prodotti non valida.';end if;
  if scope='products' then
   products:=array(select distinct value::uuid from jsonb_array_elements_text(coalesce(payload->'product_ids',case when nullif(payload->>'product_id','') is not null then jsonb_build_array(payload->>'product_id') else '[]'::jsonb end)));
   if cardinality(products)=0 or exists(select 1 from unnest(products) chosen left join prodotti p on p.id=chosen where p.id is null or p.attivo_mexal is not true or p.mostra_in_app is not true or upper(btrim(coalesce(p.codice_mexal,''))) not like 'IT%') then raise exception 'Seleziona solo prodotti Sali di Ischia attivi con codice IT.';end if;
  elsif scope='categories' then
   categories:=array(select distinct value::integer from jsonb_array_elements_text(coalesce(payload->'category_ids','[]')));
   if cardinality(categories)=0 or exists(select 1 from unnest(categories) chosen left join club_catalog_categories c on c.id=chosen where c.id is null or not c.active) then raise exception 'Seleziona categorie valide del catalogo Sali di Ischia.';end if;
  end if;
 end if;
 insert into club_rewards(id,kind,product_id,product_scope,product_ids,category_ids,name,description,budget_required,stock,delivery_methods,active,valid_until,updated_at)
 values(coalesce(target_id,gen_random_uuid()),payload->>'kind',case when cardinality(products)=1 then products[1] else null end,scope,products,categories,btrim(payload->>'name'),coalesce(payload->>'description',''),(payload->>'budget_required')::numeric,(payload->>'stock')::integer,array(select jsonb_array_elements_text(payload->'delivery_methods')),(payload->>'active')::boolean,nullif(payload->>'valid_until','')::timestamptz,clock_timestamp())
 on conflict(id) do update set kind=excluded.kind,product_id=excluded.product_id,product_scope=excluded.product_scope,product_ids=excluded.product_ids,category_ids=excluded.category_ids,name=excluded.name,description=excluded.description,budget_required=excluded.budget_required,stock=excluded.stock,delivery_methods=excluded.delivery_methods,active=excluded.active,valid_until=excluded.valid_until,updated_at=excluded.updated_at returning id into reward_id;
 if payload->>'kind'='products' and not exists(select 1 from club_reward_eligible_products(reward_id)) then raise exception 'La selezione non contiene prodotti IT disponibili.';end if;
 perform club_audit_event('REWARD_SAVED',reward_id,payload);
 return reward_id;
end $$;

create function public.club_reward_products(target_reward_id uuid,search_text text default '') returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not workspace_internal_user() then
  perform club_verified_identity();
  if not exists(select 1 from club_members where auth_user_id=auth.uid() and active) then raise exception 'Iscrizione Club non attiva.' using errcode='42501';end if;
 end if;
 if not exists(select 1 from club_rewards where id=target_reward_id and active and stock>0 and (valid_until is null or valid_until>now())) then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(to_jsonb(p) order by p.name,p.code) from club_reward_eligible_products(target_reward_id) p where length(coalesce(search_text,''))<=200 and (p.name ilike '%'||coalesce(search_text,'')||'%' or p.code ilike '%'||coalesce(search_text,'')||'%')),'[]'::jsonb);
end $$;
revoke all on function public.club_reward_products(uuid,text) from public,anon,authenticated;
grant execute on function public.club_reward_products(uuid,text) to authenticated;

-- Extend the existing atomic wallet operation, preserving member-first locks,
-- stock accounting, identity checks and its early idempotency return.
do $$declare original text;revised text;begin
 original:=pg_get_functiondef('public.club_create_request(uuid,text,numeric,text,jsonb,uuid)'::regprocedure);
 revised:=replace(original,'balance numeric;begin','balance numeric; chosen_product jsonb;begin');
 revised:=replace(revised,'cost:=reward.budget_required;', $inject$cost:=reward.budget_required;
  if reward.kind='products' then
   select jsonb_build_object('product_id',p.product_id,'product_name',p.name,'product_code',p.code) into chosen_product from club_reward_eligible_products(reward.id) p where p.product_id=coalesce(nullif(target_details->>'product_id','')::uuid,reward.product_id);
   if not found then raise exception 'Scegli un prodotto IT tra quelli previsti dal premio.';end if;
   target_details:=coalesce(target_details,'{}'::jsonb)||chosen_product;
  end if;$inject$);
 revised:=replace(revised,'else reward.name end,cost', 'else coalesce(chosen_product->>''product_name'',reward.name) end,cost');
 if revised=original or position('chosen_product jsonb' in revised)=0 or position('club_reward_eligible_products(reward.id)' in revised)=0 then raise exception 'Funzione richieste non riconosciuta.';end if;
 execute revised;
 original:=pg_get_functiondef('public.club_api_boundary()'::regprocedure);
 execute replace(original,'''/rpc/club_public_info''','''/rpc/club_reward_products'',''/rpc/club_public_info''');
end $$;
notify pgrst, 'reload schema';
commit;

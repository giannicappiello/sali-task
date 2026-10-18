begin;
alter table public.club_rewards alter column budget_required drop not null;
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.club_rewards'::regclass and contype='c' and pg_get_constraintdef(oid) like '%budget_required%' loop
  execute format('alter table public.club_rewards drop constraint %I',c.conname);
 end loop;
end $$;
update public.club_rewards set budget_required=null where kind='products';
alter table public.club_rewards add constraint club_reward_budget_kind_check check(
 (kind='products' and budget_required is null) or (kind='prizes' and budget_required is not null and budget_required>0 and budget_required<>'NaN'::numeric));

do $$declare original text;revised text;begin
 original:=pg_get_functiondef('public.club_save_reward(jsonb,uuid,timestamptz)'::regprocedure);
 revised:=replace(original,'(payload->>''budget_required'')::numeric','case when payload->>''kind''=''products'' then null else (payload->>''budget_required'')::numeric end');
 if revised=original then raise exception 'Salvataggio premi non riconosciuto.';end if;
 execute revised;
end $$;

create function public.club_quote_product_reward(target_reward_id uuid,items jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare member public.club_members;line record;pricing jsonb;price numeric;total numeric:=0;lines jsonb:='[]';normalized jsonb;result jsonb;
begin
 perform public.club_verified_identity();
 select * into member from public.club_members where auth_user_id=auth.uid() and active;
 if not found then raise exception 'Iscrizione Club non attiva.' using errcode='42501';end if;
 if not exists(select 1 from public.club_rewards where id=target_reward_id and kind='products' and active and stock>0 and (valid_until is null or valid_until>now())) then raise exception 'Premio non disponibile.';end if;
 if items is null or jsonb_typeof(items)<>'array' then raise exception 'Seleziona i prodotti del premio.';end if;
 if jsonb_array_length(items) not between 1 and 10 then raise exception 'Seleziona da uno a dieci prodotti.';end if;
 if exists(select 1 from jsonb_array_elements(items) x where jsonb_typeof(x)<>'object' or nullif(x->>'product_id','') is null or coalesce(x->>'quantity','')!~'^[0-9]{1,2}$' or (x->>'quantity')::integer not between 1 and 99) then raise exception 'Prodotti o quantità non validi.';end if;
 select jsonb_agg(jsonb_build_object('product_id',product_id,'quantity',quantity) order by product_id) into normalized
 from(select product_id,sum(quantity) quantity from jsonb_to_recordset(items) x(product_id uuid,quantity integer) group by product_id)x;
 for line in select x.product_id,x.quantity,p.name,p.code from jsonb_to_recordset(normalized)x(product_id uuid,quantity integer)
 left join public.club_reward_eligible_products(target_reward_id)p on p.product_id=x.product_id order by x.product_id loop
  if line.name is null or line.quantity>99 then raise exception 'Scegli solo prodotti IT previsti dal premio, con quantità da 1 a 99.';end if;
  pricing:=public.club_combined_product_price(line.product_id,member.trusted_store_code,normalized);
  price:=(pricing->>'price')::numeric;
  if price is null or price<0 or price='NaN'::numeric then raise exception 'Prezzo non disponibile per %.',line.name;end if;
  total:=total+round(price*line.quantity,2);
  lines:=lines||jsonb_build_array(jsonb_build_object('product_id',line.product_id,'product_name',line.name,'product_code',line.code,'quantity',line.quantity,'unit_price',price,'list_price',(pricing->>'list_price')::numeric,'amount',round(price*line.quantity,2),'offer_ids',pricing->'applied_offer_ids'));
 end loop;
 if total<=0 then raise exception 'Il totale del premio deve essere maggiore di zero.';end if;
 select jsonb_build_object('items',lines,'total',total,'store_code',member.trusted_store_code,'product_name',string_agg(x.product_name||case when x.quantity>1 then ' × '||x.quantity else '' end,', ' order by x.product_name)) into result from jsonb_to_recordset(lines)x(product_name text,quantity integer);
 return result;
end $$;
revoke all on function public.club_quote_product_reward(uuid,jsonb) from public,anon;
grant execute on function public.club_quote_product_reward(uuid,jsonb) to authenticated;

do $$declare original text;revised text;old_block text;new_block text;begin
 original:=pg_get_functiondef('public.club_create_request(uuid,text,numeric,text,jsonb,uuid)'::regprocedure);
 old_block:=$old$cost:=reward.budget_required;
  if reward.kind='products' then
   select jsonb_build_object('product_id',p.product_id,'product_name',p.name,'product_code',p.code) into chosen_product from club_reward_eligible_products(reward.id) p where p.product_id=coalesce(nullif(target_details->>'product_id','')::uuid,reward.product_id);
   if not found then raise exception 'Scegli un prodotto IT tra quelli previsti dal premio.';end if;
   target_details:=coalesce(target_details,'{}'::jsonb)||chosen_product;
  end if;$old$;
 new_block:=$new$cost:=reward.budget_required;
  if reward.kind='products' then
   chosen_product:=public.club_quote_product_reward(reward.id,coalesce(target_details->'items',jsonb_build_array(jsonb_build_object('product_id',coalesce(nullif(target_details->>'product_id','')::uuid,reward.product_id),'quantity',1))));
   cost:=(chosen_product->>'total')::numeric;
   if target_details ? 'quoted_amount' and (target_details->>'quoted_amount')::numeric is distinct from cost then raise exception 'Il prezzo o lo sconto è cambiato. Ricarica il preventivo e riprova.';end if;
   target_details:=(coalesce(target_details,'{}'::jsonb)-'product_id'-'product_name'-'product_code'-'store_code')||jsonb_build_object('items',chosen_product->'items','product_name',chosen_product->>'product_name','pricing_store_code',chosen_product->>'store_code');
  end if;$new$;
 revised:=replace(replace(original,chr(13),''),old_block,new_block);
 if position('club_quote_product_reward(reward.id' in revised)=0 then raise exception 'Funzione richieste non riconosciuta.';end if;
 revised:=replace(revised,'octet_length(target_details::text)>4000','octet_length(target_details::text)>(case when target_mode=''products'' then 16000 else 4000 end)');
 execute revised;
 original:=pg_get_functiondef('public.club_api_boundary()'::regprocedure);
 revised:=replace(original,'''/rpc/club_reward_products''','''/rpc/club_quote_product_reward'',''/rpc/club_reward_products''');
 if revised=original then raise exception 'Confine API Club non riconosciuto.';end if;
 execute revised;
end $$;
notify pgrst,'reload schema';
commit;
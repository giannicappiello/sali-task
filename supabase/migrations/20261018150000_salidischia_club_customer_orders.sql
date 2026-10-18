begin;
create table public.club_product_orders (
 id uuid primary key default gen_random_uuid(),member_id uuid not null references public.club_members(id),
 store_code text not null references public.club_stores(store_code),store_name text not null,
 customer_name text not null,status text not null default 'sent' check(status in ('sent','received','ready')),
 items jsonb not null,total numeric(14,2) not null check(total>=0),note text not null default '',
 idempotency_key uuid not null,created_at timestamptz not null default now(),received_at timestamptz,ready_at timestamptz,
 updated_by uuid references auth.users(id),unique(member_id,idempotency_key)
);
create index club_product_orders_store_idx on public.club_product_orders(store_code,created_at desc);
create index club_product_orders_member_idx on public.club_product_orders(member_id,created_at desc);
alter table public.club_product_orders enable row level security;
revoke all on public.club_product_orders from public,anon,authenticated;
grant all on public.club_product_orders to service_role;

create function public.club_quote_order(items jsonb) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare member public.club_members;store_name text;lines jsonb;gifts jsonb;begin
 perform public.club_verified_identity();
 select * into member from club_members where auth_user_id=auth.uid() and active;
 if not found then raise exception 'Accedi come cliente Club per ordinare.' using errcode='42501';end if;
 select c.ragione_sociale into store_name from club_stores s join ordini_clienti_cache c on c.codice_cliente=s.store_code where s.store_code=member.trusted_store_code and s.enabled and c.attivo_mexal is not false;
 if not found then raise exception 'Scegli un negozio di fiducia attivo prima di ordinare.';end if;
 if items is null or jsonb_typeof(items)<>'array' then raise exception 'Carrello non valido.';end if;
 if jsonb_array_length(items) not between 1 and 100 then raise exception 'Il carrello deve contenere da 1 a 100 prodotti.';end if;
 if exists(select 1 from jsonb_to_recordset(items) x(product_id uuid,quantity numeric) where product_id is null or quantity is null or quantity not between 1 and 99 or quantity<>trunc(quantity) or not club_offer_product_available(product_id))
 or (select count(distinct x.product_id) from jsonb_to_recordset(items) x(product_id uuid))<>jsonb_array_length(items) then raise exception 'Controlla i prodotti e le quantità del carrello.';end if;
 select jsonb_agg(jsonb_build_object('product_id',p.id,'code',p.codice_mexal,'name',c.display_name,'quantity',x.quantity,'unit_price',(pricing->>'price')::numeric,'amount',round(x.quantity*(pricing->>'price')::numeric,2),'applied_offer_ids',pricing->'applied_offer_ids') order by c.display_name,p.id) into lines
 from jsonb_to_recordset(items) x(product_id uuid,quantity integer) join prodotti p on p.id=x.product_id join club_catalog_products c on c.product_id=p.id
 cross join lateral(select club_combined_product_price(p.id,member.trusted_store_code,items) pricing)y;
 if exists(select 1 from jsonb_array_elements(lines) x where x->>'unit_price' is null) then raise exception 'Un prodotto non ha un prezzo disponibile. Contatta il negozio.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('product_id',a.gift_product_id,'name',c.display_name,'quantity',a.gift_quantity,'unit_price',0,'amount',0,'gift',true,'offer_id',a.id) order by a.published_at,a.id),'[]') into gifts
 from club_active_store_offers(member.trusted_store_code) a join club_catalog_products c on c.product_id=a.gift_product_id
 where a.kind='bundle_gift' and a.combination_mode<>'best' and club_offer_qualifies(a.id,items)
 and not exists(select 1 from club_store_offer_requirements r where r.offer_id=a.id and not (club_combined_product_price(r.product_id,member.trusted_store_code,items)->'applied_offer_ids') @> jsonb_build_array(a.id));
 return jsonb_build_object('store_code',member.trusted_store_code,'store_name',store_name,'items',lines||gifts,'total',(select sum((l->>'amount')::numeric) from jsonb_array_elements(lines) l));
end $$;

create function public.club_send_order(items jsonb,idempotency_key uuid,expected_quote jsonb,note text default '') returns uuid language plpgsql security definer set search_path=public as $$
declare member public.club_members;quote jsonb;order_id uuid;begin
 perform public.club_verified_identity();select * into member from club_members where auth_user_id=auth.uid() and active for update;
 if not found then raise exception 'Iscrizione cliente non attiva.' using errcode='42501';end if;
 if idempotency_key is null then raise exception 'Identificativo invio mancante.';end if;
 select o.id into order_id from club_product_orders o where o.member_id=member.id and o.idempotency_key=club_send_order.idempotency_key;
 if found then return order_id;end if;
 if length(coalesce(note,''))>1000 then raise exception 'Nota troppo lunga.';end if;
 quote:=club_quote_order(items);
 if expected_quote is distinct from quote then raise exception 'Prezzi, offerte o negozio sono cambiati. Aggiorna il carrello e conferma il nuovo riepilogo.' using errcode='40001';end if;
 insert into club_product_orders(member_id,store_code,store_name,customer_name,items,total,note,idempotency_key)
 select member.id,quote->>'store_code',quote->>'store_name',a.nome,quote->'items',(quote->>'total')::numeric,btrim(coalesce(note,'')),idempotency_key from crm_accounts a where a.id=member.crm_account_id returning id into order_id;
 return order_id;
end $$;

create function public.club_orders(page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare store text;current_member_id uuid;begin
 perform public.club_verified_identity();store:=club_store_code();
 select m.id into current_member_id from club_members m where m.auth_user_id=auth.uid() and m.active;
 if store is null and current_member_id is null then raise exception 'Accesso ordini non autorizzato.' using errcode='42501';end if;
 if page_offset is null or page_offset<0 then raise exception 'Pagina non valida.';end if;
 return jsonb_build_object('total',(select count(*) from club_product_orders o where (store is not null and o.store_code=store) or (store is null and o.member_id=current_member_id)),
 'incoming',(select count(*) from club_product_orders o where o.store_code=store and o.status='sent'),
 'rows',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id) from(select o.id,o.store_name,o.customer_name,o.status,o.items,o.total,o.note,o.created_at,o.received_at,o.ready_at from club_product_orders o where (store is not null and o.store_code=store) or (store is null and o.member_id=current_member_id) order by o.created_at desc,o.id limit 20 offset page_offset)v),'[]'));
end $$;
create function public.club_update_order(target_id uuid,next_status text) returns void language plpgsql security definer set search_path=public as $$
declare store text;row public.club_product_orders;begin
 perform club_verified_identity();store:=club_store_code();
 if store is null then raise exception 'Accesso negozio non attivo.' using errcode='42501';end if;
 select * into row from club_product_orders o where o.id=target_id and o.store_code=store for update;
 if not found then raise exception 'Ordine non disponibile per questo negozio.' using errcode='42501';end if;
 if next_status is null or next_status not in ('received','ready') then raise exception 'Stato ordine non valido.';end if;
 if row.status=next_status then return;end if;
 if not ((row.status='sent' and next_status='received') or (row.status='received' and next_status='ready')) then raise exception 'Conferma prima la ricezione dell’ordine. Aggiorna l’elenco prima di procedere.';end if;
 update club_product_orders set status=next_status,received_at=case when next_status='received' then clock_timestamp() else received_at end,ready_at=case when next_status='ready' then clock_timestamp() else ready_at end,updated_by=auth.uid() where id=target_id;
end $$;
revoke all on function public.club_quote_order(jsonb),public.club_send_order(jsonb,uuid,jsonb,text),public.club_orders(integer),public.club_update_order(uuid,text) from public,anon;
grant execute on function public.club_quote_order(jsonb),public.club_send_order(jsonb,uuid,jsonb,text),public.club_orders(integer),public.club_update_order(uuid,text) to authenticated;
do $$declare original text;begin
 select pg_get_functiondef('public.club_api_boundary()'::regprocedure) into original;
 execute replace(original,'''/rpc/club_public_info''','''/rpc/club_quote_order'',''/rpc/club_send_order'',''/rpc/club_orders'',''/rpc/club_update_order'',''/rpc/club_public_info''');
end $$;
notify pgrst,'reload schema';
commit;

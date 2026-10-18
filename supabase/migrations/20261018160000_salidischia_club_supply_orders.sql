begin;
create table public.club_supply_orders (
 id uuid primary key default gen_random_uuid(),store_code text not null references public.club_stores(store_code),
 actor_auth_id uuid not null references auth.users(id),request_key uuid not null,
 workspace_order_id uuid not null unique references public.ordini_testate(id),quote jsonb not null,
 created_at timestamptz not null default now(),unique(store_code,request_key)
);
create table public.club_supply_allocations (
 supply_id uuid not null references public.club_supply_orders(id),customer_order_id uuid not null references public.club_product_orders(id),
 product_id uuid not null references public.prodotti(id),quantity integer not null check(quantity>0),primary key(supply_id,customer_order_id,product_id)
);
create index club_supply_allocation_source_idx on public.club_supply_allocations(customer_order_id,product_id);
alter table public.club_supply_orders enable row level security;
alter table public.club_supply_allocations enable row level security;
revoke all on public.club_supply_orders,public.club_supply_allocations from public,anon,authenticated;
grant all on public.club_supply_orders,public.club_supply_allocations to service_role;

create function public.club_supply_store(actor_id uuid) returns text language plpgsql stable security definer set search_path=public as $$
declare store text;begin
 select u.store_code into store from club_store_users u join club_stores s on s.store_code=u.store_code
 join auth.users a on a.id=u.auth_user_id join ordini_clienti_cache c on c.codice_cliente=u.store_code
 where u.auth_user_id=actor_id and u.active and s.enabled and a.email_confirmed_at is not null and c.attivo_mexal is not false;
 if store is null then raise exception 'Accesso negozio non attivo.' using errcode='42501';end if;return store;
end $$;
create function public.club_supply_pending(store text) returns jsonb language sql stable security definer set search_path=public as $$
 with ordered as (
 select o.id,o.created_at,(i->>'product_id')::uuid product_id,sum((i->>'quantity')::integer)::integer quantity
 from club_product_orders o cross join lateral jsonb_array_elements(o.items) i where o.store_code=store and o.status in ('sent','received')
 group by o.id,o.created_at,(i->>'product_id')::uuid),
 used as (select a.customer_order_id,a.product_id,sum(a.quantity) quantity from club_supply_allocations a join club_supply_orders b on b.id=a.supply_id
 join ordini_testate h on h.id=b.workspace_order_id where b.store_code=store and h.stato<>'annullato' group by a.customer_order_id,a.product_id),
 pending as (select o.id,o.created_at,o.product_id,greatest(0,o.quantity-coalesce(u.quantity,0))::integer quantity from ordered o left join used u on u.customer_order_id=o.id and u.product_id=o.product_id),
 grouped as (select p.id product_id,upper(btrim(p.codice_mexal)) code,c.display_name name,sum(x.quantity)::integer quantity,
 jsonb_agg(jsonb_build_object('order_id',x.id,'quantity',x.quantity) order by x.created_at,x.id) sources
 from pending x join prodotti p on p.id=x.product_id join club_catalog_products c on c.product_id=p.id where x.quantity>0 group by p.id,p.codice_mexal,c.display_name),
 result as (select coalesce(jsonb_agg(to_jsonb(g) order by g.code,g.product_id),'[]') rows from grouped g)
 select jsonb_build_object('rows',rows,'revision',md5(rows::text),'orders_count',(select count(distinct id) from pending where quantity>0)) from result;
$$;
create function public.club_supply_state(actor_id uuid,request_key uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare store text:=club_supply_store(actor_id);existing jsonb;begin
 select jsonb_build_object('id',s.id,'workspace_order_id',s.workspace_order_id,'number',h.numero_ordine_visualizzato,'agent_name',s.quote->>'agent_name','total',s.quote->'totals'->'totale_documento') into existing
 from club_supply_orders s join ordini_testate h on h.id=s.workspace_order_id where s.store_code=store and s.request_key=club_supply_state.request_key;
 return club_supply_pending(store)||jsonb_build_object('store_code',store,'existing',existing);
end $$;
create function public.club_supply_allowed_products(ids uuid[]) returns uuid[] language sql stable security definer set search_path=public as $$
 select coalesce(array_agg(p.id),'{}'::uuid[]) from prodotti p where p.id=any(ids) and upper(btrim(p.codice_mexal)) like 'IT%' and club_offer_product_available(p.id);
$$;

-- Only the authenticated server can supply the commercial calculation. Club users
-- cannot call this endpoint or write a price, agent or Workspace order directly.
create function public.club_commit_supply_order(actor_id uuid,request_key uuid,payload jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare store text:=club_supply_store(actor_id);existing jsonb;snapshot jsonb;quote jsonb:=payload->'quote';header jsonb:=payload->'header';
 agent public.mexal_agenti;customer public.ordini_clienti_cache;order_id uuid:=gen_random_uuid();supply_id uuid:=gen_random_uuid();
 line jsonb;source jsonb;pending_line jsonb;remaining integer;take integer;result jsonb;begin
 if request_key is null then raise exception 'Identificativo invio mancante.';end if;
 perform 1 from club_stores where store_code=store for update;
 select club_supply_state(actor_id,request_key)->'existing' into existing;
 if existing is not null and existing<>'null'::jsonb then return existing;end if;
 -- Lock source orders too: two sends or a simultaneous ready-for-pickup update
 -- cannot consume the same quantities.
 perform 1 from club_product_orders where store_code=store and status in ('sent','received') order by id for update;
 snapshot:=club_supply_pending(store);
 if quote->>'source_revision' is distinct from snapshot->>'revision' then raise exception 'Gli ordini dei clienti sono cambiati. Aggiorna il riepilogo prima di inviare.' using errcode='40001';end if;
 select * into customer from ordini_clienti_cache where codice_cliente=store for share;
 select a.* into agent from mexal_agenti a join utenti u on u.id=a.workspace_utente_id and u.attivo
 where a.codice=customer.codice_agente_mexal and a.attivo_mexal and a.accesso_workspace_attivo;
 if not found or agent.codice is distinct from quote->>'agent_code' then raise exception 'Agente di riferimento non disponibile. Aggiorna il riepilogo o contatta PROGRE''.' using errcode='40001';end if;
 if jsonb_typeof(quote->'lines')<>'array' or jsonb_array_length(quote->'lines') not between 1 and 200 then raise exception 'Inserisci da 1 a 200 prodotti.';end if;
 if exists(select 1 from jsonb_array_elements(quote->'lines') x where (x->>'quantity')::numeric not between 1 and 1000000 or (x->>'quantity')::numeric<>trunc((x->>'quantity')::numeric) or not club_offer_product_available((x->>'product_id')::uuid)) then raise exception 'Controlla prodotti e quantità.';end if;
 insert into ordini_testate(id,codice_cliente,ragione_sociale_cliente,codice_agente_mexal,data_ordine,stato,modulo_ordini,commenti,partita_iva,codice_pagamento,descrizione_pagamento,codice_listino,indirizzo_spedizione,totale,totale_imponibile,totale_iva,totale_documento,importo_minimo_porto_franco,addebito_spedizione)
 values(order_id,store,customer.ragione_sociale,agent.codice,(header->>'data_ordine')::date,'bozza',header->>'modulo_ordini',header->>'commenti',header->>'partita_iva',nullif(header->>'codice_pagamento','')::integer,header->>'descrizione_pagamento',nullif(header->>'codice_listino','')::integer,header->>'indirizzo_spedizione',(header->>'totale_documento')::numeric,(header->>'totale_imponibile')::numeric,(header->>'totale_iva')::numeric,(header->>'totale_documento')::numeric,(header->>'importo_minimo_porto_franco')::numeric,(header->>'addebito_spedizione')::numeric);
 for line in select value from jsonb_array_elements(payload->'workspace_lines') loop
  insert into ordini_righe(ordine_id,codice_articolo,descrizione,quantita,prezzo_listino,prezzo_netto,sconto_percentuale,sconto_commerciale,sconto_pagamento,origine_prezzo,origine_sconto,regola_prezzo_id,regola_sconto_id,regola_pagamento_id,dettaglio_calcolo,codice_iva_mexal,aliquota_iva,imponibile_riga,iva_riga,totale_riga,riga_spedizione,riga_descrittiva,iva_non_applicata)
  values(order_id,line->>'codice_articolo',line->>'descrizione',(line->>'quantita')::numeric,(line->>'prezzo_listino')::numeric,(line->>'prezzo_netto')::numeric,coalesce((line->>'sconto_percentuale')::numeric,0),line->>'sconto_commerciale',line->>'sconto_pagamento',line->>'origine_prezzo',line->>'origine_sconto',nullif(line->>'regola_prezzo_id','')::bigint,nullif(line->>'regola_sconto_id','')::bigint,nullif(line->>'regola_pagamento_id','')::bigint,coalesce(line->'dettaglio_calcolo','{}'),line->>'codice_iva_mexal',nullif(line->>'aliquota_iva','')::numeric,(line->>'imponibile_riga')::numeric,(line->>'iva_riga')::numeric,(line->>'totale_riga')::numeric,coalesce((line->>'riga_spedizione')::boolean,false),coalesce((line->>'riga_descrittiva')::boolean,false),coalesce((line->>'iva_non_applicata')::boolean,false));
 end loop;
 insert into club_supply_orders(id,store_code,actor_auth_id,request_key,workspace_order_id,quote) values(supply_id,store,actor_id,request_key,order_id,quote);
 for line in select value from jsonb_array_elements(quote->'lines') loop
  remaining:=(line->>'quantity')::integer;
  select value into pending_line from jsonb_array_elements(snapshot->'rows') where value->>'product_id'=line->>'product_id';
  for source in select value from jsonb_array_elements(coalesce(pending_line->'sources','[]')) loop
   take:=least(remaining,(source->>'quantity')::integer);exit when take<=0;
   insert into club_supply_allocations values(supply_id,(source->>'order_id')::uuid,(line->>'product_id')::uuid,take);remaining:=remaining-take;
  end loop;
 end loop;
 insert into notifiche(utente_id,titolo,messaggio,tipo,evento,url,link,metadata)
 values(agent.workspace_utente_id,'Nuovo ordine Club da '||customer.ragione_sociale,'Il negozio ha inviato un ordine a PROGRE''. Apri il riepilogo per la presa in carico.','ordine_nuovo','ordine_nuovo',case when header->>'modulo_ordini'='ph' then '/ordini-ph/elenco/' else '/ordini-prof/elenco/' end||order_id::text,case when header->>'modulo_ordini'='ph' then '/ordini-ph/elenco/' else '/ordini-prof/elenco/' end||order_id::text,jsonb_build_object('ordine_id',order_id,'club_supply_id',supply_id));
 select club_supply_state(actor_id,request_key)->'existing' into result;return result;
end $$;
create function public.club_supply_history() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare store text;begin
 perform club_verified_identity();store:=club_store_code();if store is null then raise exception 'Accesso negozio non attivo.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc,id) from(select s.id,s.created_at,s.quote,h.numero_ordine_visualizzato number,h.stato status from club_supply_orders s join ordini_testate h on h.id=s.workspace_order_id where s.store_code=store order by s.created_at desc,s.id limit 30)x),'[]');
end $$;
revoke all on function public.club_supply_store(uuid),public.club_supply_pending(text),public.club_supply_state(uuid,uuid),public.club_supply_allowed_products(uuid[]),public.club_commit_supply_order(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.club_supply_state(uuid,uuid),public.club_supply_allowed_products(uuid[]),public.club_commit_supply_order(uuid,uuid,jsonb) to service_role;
revoke all on function public.club_supply_history() from public,anon;
grant execute on function public.club_supply_history() to authenticated;
do $$declare original text;begin
 select pg_get_functiondef('public.club_api_boundary()'::regprocedure) into original;
 execute replace(original,'''/rpc/club_public_info''','''/rpc/club_supply_history'',''/rpc/club_public_info''');
end $$;
notify pgrst,'reload schema';
commit;

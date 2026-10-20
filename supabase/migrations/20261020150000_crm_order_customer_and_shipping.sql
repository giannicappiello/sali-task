-- Enrich only the source-owned contact: never merge identities across providers or overwrite Mexal.
create or replace function public.crm_enrich_customer_profile_service(target_connection_id uuid, profile jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare c public.crm_external_connections; a uuid; previous jsonb; enriched jsonb; customer uuid; order_pk uuid; line jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'Servizio riservato' using errcode='42501'; end if;
  select * into strict c from public.crm_external_connections where id=target_connection_id;
  if nullif(profile->>'external_id','') is null then raise exception 'Identità sorgente mancante'; end if;
  -- The unique source key serializes concurrent refreshes and prevents duplicate contacts.
  insert into public.crm_external_customers(connection_id,external_id,email_hash,responsabile_id,reparto_id)
    values(c.id,profile->>'external_id',profile->>'email_hash',c.responsabile_id,c.reparto_id)
    on conflict(connection_id,external_id) do update set email_hash=coalesce(excluded.email_hash,crm_external_customers.email_hash)
    returning id,account_id into customer,a;
  if a is null then
    insert into public.crm_accounts(tipo,nome,email,fonte,responsabile_id,reparto_id,metadati)
      values('online',coalesce(profile->>'nome','Nominativo non disponibile'),profile->>'email',c.provider_code,c.responsabile_id,c.reparto_id,
        jsonb_build_object('connection_id',c.id,'external_id',profile->>'external_id')) returning id into a;
    update public.crm_external_customers set account_id=a,identity_status='matched',identity_method='provider-id' where id=customer;
  end if;
  select coalesce(metadati->'anagrafica','{}') into previous from public.crm_accounts where id=a;
  enriched := coalesce(previous,'{}') || jsonb_strip_nulls(coalesce(profile->'anagrafica','{}'));
  enriched := enriched || jsonb_build_object(
    'fatturazione', coalesce(previous->'fatturazione','{}') || jsonb_strip_nulls(coalesce(profile->'anagrafica'->'fatturazione','{}')),
    'spedizione', coalesce(previous->'spedizione','{}') || jsonb_strip_nulls(coalesce(profile->'anagrafica'->'spedizione','{}')));
  update public.crm_accounts set
    nome=coalesce(nullif(btrim(concat_ws(' ',enriched->>'cognome',enriched->>'nome')),''),
      nullif(enriched->>'azienda',''),case when nome not like '%@%' then nome end,'Nominativo non disponibile'),
    email=coalesce(nullif(profile->>'email',''),email),
    telefono=coalesce(nullif(profile->>'telefono',''),telefono),
    indirizzo=coalesce(nullif(profile->>'indirizzo',''),indirizzo),
    citta=coalesce(nullif(profile->>'citta',''),citta), provincia=coalesce(nullif(profile->>'provincia',''),provincia),
    cap=coalesce(nullif(profile->>'cap',''),cap), paese=coalesce(nullif(profile->>'paese',''),paese),
    partita_iva=coalesce(nullif(profile->>'partita_iva',''),partita_iva), codice_fiscale=coalesce(nullif(profile->>'codice_fiscale',''),codice_fiscale),
    metadati=metadati || jsonb_build_object('anagrafica',enriched), aggiornato_il=now()
  where id=a and codice_cliente_mexal is null and fonte=c.provider_code
    and metadati->>'connection_id'=c.id::text;
  if nullif(profile->>'order_external_id','') is not null then
    update public.crm_external_orders set account_id=coalesce(account_id,a),external_customer_id=coalesce(external_customer_id,customer),
      raw_summary=raw_summary || jsonb_build_object('customer_name',profile->>'nome'),aggiornato_il=now()
      where connection_id=c.id and external_id=profile->>'order_external_id' returning id into order_pk;
    if order_pk is not null and jsonb_typeof(profile->'order_lines')='array' then
      delete from public.crm_external_order_lines l where l.order_id=order_pk
        and (l.metadati->>'type'='shipping' or l.external_line_id like 'shipping:%')
        and not exists(select 1 from jsonb_array_elements(profile->'order_lines') incoming where incoming->>'external_line_id'=l.external_line_id);
      for line in select value from jsonb_array_elements(profile->'order_lines') loop
        if line->>'type'='shipping' then
          insert into public.crm_external_order_lines(order_id,external_line_id,quantity,unit_price,discount,line_revenue,metadati)
            values(order_pk,line->>'external_line_id',1,(line->>'unit_price')::numeric,0,(line->>'line_revenue')::numeric,
              jsonb_build_object('type','shipping','name',line->>'name'))
            on conflict(order_id,external_line_id) do update set quantity=1,unit_price=excluded.unit_price,
              discount=0,line_revenue=excluded.line_revenue,metadati=excluded.metadati;
        else
          update public.crm_external_order_lines set metadati=metadati || jsonb_build_object('type','product','name',line->>'name')
            where order_id=order_pk and external_line_id=line->>'external_line_id';
        end if;
      end loop;
    end if;
    update public.crm_external_customers ec set first_order_at=s.first_at,last_order_at=s.last_at,order_count=s.n,total_value=s.total
      from (select min(ordered_at) first_at,max(ordered_at) last_at,count(*) n,sum(net_revenue) total from public.crm_external_orders
        where external_customer_id=customer and lower(coalesce(stato,'')) not in ('cancelled','canceled','failed','pending','on-hold','pending_availability')) s where ec.id=customer;
  end if;
end $$;
revoke all on function public.crm_enrich_customer_profile_service(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crm_enrich_customer_profile_service(uuid,jsonb) to service_role;


-- Upgrade the page wrapper without changing its cursor transaction or core importer.
create or replace function public.crm_import_commerce_page_service(
  target_connection_id uuid, target_run_id uuid, expected_state jsonb,
  resource_kind text, page_rows jsonb, next_state jsonb
) returns void language plpgsql security definer set search_path=public as $$
declare r jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'Servizio riservato' using errcode='42501'; end if;
  perform public.crm_import_commerce_page_core_service(target_connection_id,target_run_id,expected_state,resource_kind,page_rows,next_state);
  for r in select value from jsonb_array_elements(page_rows) loop
    if resource_kind='customers' then
      perform public.crm_enrich_customer_profile_service(target_connection_id,r);
    elsif resource_kind='orders' and jsonb_typeof(r->'customer')='object' then
      perform public.crm_enrich_customer_profile_service(target_connection_id,(r->'customer') || jsonb_build_object('order_external_id',r->>'external_id','order_lines',r->'lines'));
    end if;
  end loop;
end $$;
revoke all on function public.crm_import_commerce_page_service(uuid,uuid,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.crm_import_commerce_page_service(uuid,uuid,jsonb,text,jsonb,jsonb) to service_role;

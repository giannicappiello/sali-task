-- Enrich only the source-owned contact: never merge identities across providers or overwrite Mexal.
create or replace function public.crm_enrich_customer_profile_service(target_connection_id uuid, profile jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare c public.crm_external_connections; a uuid; previous jsonb; enriched jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'Servizio riservato' using errcode='42501'; end if;
  select * into strict c from public.crm_external_connections where id=target_connection_id;
  select account_id into a from public.crm_external_customers
    where connection_id=c.id and external_id=profile->>'external_id';
  if a is null then return; end if;
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
end $$;
revoke all on function public.crm_enrich_customer_profile_service(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crm_enrich_customer_profile_service(uuid,jsonb) to service_role;

-- Keep enrichment, page data and cursor inside the same transaction and source lock.
alter function public.crm_import_commerce_page_service(uuid,uuid,jsonb,text,jsonb,jsonb)
  rename to crm_import_commerce_page_core_service;
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
      perform public.crm_enrich_customer_profile_service(target_connection_id,r->'customer');
    end if;
  end loop;
end $$;
revoke all on function public.crm_import_commerce_page_service(uuid,uuid,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.crm_import_commerce_page_service(uuid,uuid,jsonb,text,jsonb,jsonb) to service_role;

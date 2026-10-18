begin;
create or replace function public.club_retailer_customer(target_store text) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('store_code',c.codice_cliente,'legal_name',c.ragione_sociale,
 'email',btrim(split_part(replace(coalesce(c.email,''),';',','),',',1)),
 'vat_number',c.partita_iva,'tax_code',to_jsonb(c)->>'codice_fiscale',
 'address',c.indirizzo,'postal_code',c.cap,'city',to_jsonb(c)->>'localita',
 'province',c.provincia,'country',to_jsonb(c)->>'paese','phone',to_jsonb(c)->>'telefono','shop_name',s.display_name)
 from ordini_clienti_cache c join crm_customer_classifications k on k.codice_cliente=c.codice_cliente and k.area_crm='b2b'
 left join club_stores s on s.store_code=c.codice_cliente
 where c.codice_cliente=target_store and c.attivo_mexal is not false and coalesce(s.enabled,true)
 and not exists(select 1 from crm_customer_status st where st.customer_key='mexal:'||c.codice_cliente and not st.crm_active);
$$;
revoke all on function public.club_retailer_customer(text) from public,anon,authenticated;
grant execute on function public.club_retailer_customer(text) to service_role;
commit;

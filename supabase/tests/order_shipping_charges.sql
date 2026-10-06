-- Execute inside BEGIN / ROLLBACK; fixtures never leave the transaction.
do $$
declare
  v_order uuid;
  v_module text;
  v_code text := '_WORKSPACE_SHIPPING_TRANSACTION_TEST_';
  v_header jsonb;
  v_lines jsonb;
  v_duplicate_rejected boolean := false;
begin
  insert into public.ordini_prodotti_cache(codice_articolo,descrizione,disponibilita,impegnato)
    values(v_code,'Shipping transaction test',100,0);
  foreach v_module in array array['prof','ph','private'] loop
    insert into public.ordini_moduli_configurazione(modulo_ordini,importo_minimo_porto_franco,addebito_spedizione)
      values(v_module,100,10) on conflict(modulo_ordini) do update set importo_minimo_porto_franco=100,addebito_spedizione=10;
    insert into public.ordini_testate(data_ordine,stato,modulo_ordini,codice_cliente,ragione_sociale_cliente,stato_sincronizzazione)
      values(current_date,'bozza',v_module,(select codice_cliente from public.ordini_clienti_cache limit 1),'Shipping transaction test','non_avviato') returning id into v_order;
    insert into public.ordini_righe(ordine_id,codice_articolo,descrizione,quantita,prezzo_listino,prezzo_netto,imponibile_riga,iva_riga,totale_riga,aliquota_iva,codice_iva_mexal)
      values(v_order,v_code,'Test product',1,80,80,80,17.6,97.6,22,'22,0');
    perform public.applica_spedizione_ordine(v_order);
    if (select count(*) from public.ordini_righe where ordine_id=v_order and riga_spedizione)<>1 then raise exception 'Missing shipping for %',v_module; end if;
    if (select totale_documento from public.ordini_testate where id=v_order)<>109.8 then raise exception 'Incorrect total for %',v_module; end if;
    if (select codice_articolo is not null or quantita_ocm<>0 or quantita_ocx<>0 or quantita_oci<>0 from public.ordini_righe where ordine_id=v_order and riga_spedizione) then raise exception 'Shipping is not a stock article'; end if;
    perform public.applica_spedizione_ordine(v_order);
    if (select count(*) from public.ordini_righe where ordine_id=v_order and riga_spedizione)<>1 then raise exception 'Duplicate shipping'; end if;
    update public.ordini_righe set prezzo_listino=100,prezzo_netto=100,imponibile_riga=100,iva_riga=22,totale_riga=122 where ordine_id=v_order and not riga_spedizione;
    perform public.applica_spedizione_ordine(v_order);
    if exists(select 1 from public.ordini_righe where ordine_id=v_order and riga_spedizione) then raise exception 'Threshold equality charged shipping'; end if;
    update public.ordini_righe set prezzo_listino=90,prezzo_netto=90,imponibile_riga=90,iva_riga=19.8,totale_riga=109.8 where ordine_id=v_order and not riga_spedizione;
    perform public.applica_spedizione_ordine(v_order);
    if not exists(select 1 from public.ordini_righe where ordine_id=v_order and riga_spedizione) then raise exception 'VAT affected net threshold'; end if;
    select to_jsonb(o) into v_header from public.ordini_testate o where id=v_order;
    select jsonb_agg(to_jsonb(r)) into v_lines from public.ordini_righe r where ordine_id=v_order;
    perform public.aggiorna_ordine_operativo(v_order,v_header,v_lines);
    if (select count(*) from public.ordini_righe where ordine_id=v_order and riga_spedizione)<>1 then raise exception 'Atomic edit lost shipping'; end if;
    -- The database re-reads current configuration at confirmation.
    update public.ordini_moduli_configurazione set addebito_spedizione=15 where modulo_ordini=v_module;
    update public.ordini_prodotti_cache set disponibilita=100,impegnato=0 where codice_articolo=v_code;
    perform public.conferma_ordine_workspace(v_order);
    if (select imponibile_riga from public.ordini_righe where ordine_id=v_order and riga_spedizione)<>15 then raise exception 'Confirmation ignored current fee'; end if;
    if (select totale_documento from public.ordini_testate where id=v_order)<>128.1 then raise exception 'Confirmation total mismatch'; end if;
    if (select disponibilita from public.ordini_prodotti_cache where codice_articolo=v_code)<>99 then raise exception 'Shipping reserved stock'; end if;
  end loop;
  begin
    insert into public.ordini_moduli_configurazione(modulo_ordini,addebito_spedizione) values('_invalid_shipping_',-1);
  exception when check_violation then v_duplicate_rejected:=true;
  end;
  if not v_duplicate_rejected then raise exception 'Negative fee accepted'; end if;
end;
$$;
select 'PASS: PROF, PH, PRIVATE; net threshold; idempotence; atomic edit; current config; no stock charge' as shipping_test_result;

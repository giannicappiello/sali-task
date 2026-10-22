-- Execute inside BEGIN / ROLLBACK. Fixtures never leave the transaction.
do $$
declare v_order uuid;v_module text;v_customer text;v_line public.ordini_righe%rowtype;
 v_code text:='_NO_PAYMENT_DISCOUNT_TEST_';v_expected numeric;
begin
 select codice_cliente into strict v_customer from public.ordini_clienti_cache where paese='IT' limit 1;
 insert into public.ordini_prodotti_cache(codice_articolo,descrizione,disponibilita,impegnato) values(v_code,'Payment discount test',100,0);
 foreach v_module in array array['prof','ph','private'] loop
  update public.ordini_moduli_configurazione set importo_minimo_porto_franco=175,addebito_spedizione=10 where modulo_ordini=v_module;
  insert into public.ordini_testate(data_ordine,stato,modulo_ordini,codice_cliente,ragione_sociale_cliente,stato_sincronizzazione)
   values(current_date,'bozza',v_module,v_customer,'Payment test','non_avviato') returning id into v_order;
  insert into public.ordini_righe(ordine_id,codice_articolo,descrizione,quantita,prezzo_listino,prezzo_netto,imponibile_riga,iva_riga,totale_riga,aliquota_iva,codice_iva_mexal,sconto_commerciale,sconto_pagamento,dettaglio_calcolo)
   values(v_order,v_code,'Payment test',2,100,85.5,171,37.62,208.62,22,'22,0','10+5','5','{"sconto_commerciale":"10","sconto_pagamento":"5"}');
  perform public.conferma_ordine_workspace(v_order);
  select * into strict v_line from public.ordini_righe where ordine_id=v_order and not riga_spedizione;
  if v_module in ('prof','ph') then
   if v_line.sconto_pagamento is not null or v_line.sconto_commerciale<>'10' or v_line.prezzo_netto<>90 or v_line.imponibile_riga<>180 or v_line.iva_riga<>39.6 then raise exception 'Payment discount still applied in %: %',v_module,row_to_json(v_line);end if;
   if exists(select 1 from public.ordini_righe where ordine_id=v_order and riga_spedizione) then raise exception 'Shipping used discounted net';end if;
   v_expected:=219.6;
  else
   if v_line.sconto_pagamento<>'5' or v_line.prezzo_netto<>85.5 then raise exception 'Private changed';end if;
   v_expected:=220.82;
  end if;
  if (select totale_documento from public.ordini_testate where id=v_order)<>v_expected then raise exception 'Incorrect confirmation total in %',v_module;end if;
 end loop;
 -- Confirmed history is never normalized by the new trigger.
 insert into public.ordini_testate(data_ordine,stato,modulo_ordini,codice_cliente,ragione_sociale_cliente,stato_sincronizzazione)
  values(current_date,'aperto','prof',v_customer,'Historical test','non_avviato') returning id into v_order;
 insert into public.ordini_righe(ordine_id,codice_articolo,descrizione,quantita,prezzo_listino,prezzo_netto,imponibile_riga,iva_riga,totale_riga,aliquota_iva,sconto_commerciale,sconto_pagamento)
  values(v_order,v_code,'Historical test',2,100,85.5,171,37.62,208.62,22,'10','5');
 if (select sconto_pagamento from public.ordini_righe where ordine_id=v_order)<>'5' then raise exception 'Historical discount changed';end if;
end;$$;
select 'PASS: PR/PH commercial-only; confirmation; shipping threshold; Private and history preserved' as result;

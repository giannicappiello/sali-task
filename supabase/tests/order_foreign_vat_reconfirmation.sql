do $$
declare v_order uuid; v_customer text; v_module text; v_header jsonb; v_lines jsonb;
  v_code text:='_FOREIGN_VAT_RECONFIRM_TEST_'; v_duplicate boolean:=false;
begin
 select codice_cliente into v_customer from public.ordini_clienti_cache where paese='IT' limit 1;
 if v_customer is null then raise exception 'Missing test customer'; end if;
 update public.ordini_clienti_cache set paese='FR' where codice_cliente=v_customer;
 insert into public.ordini_prodotti_cache(codice_articolo,descrizione,disponibilita,impegnato) values(v_code,'VAT test',100,0);
 foreach v_module in array array['prof','ph','private'] loop
  update public.ordini_moduli_configurazione set importo_minimo_porto_franco=200,addebito_spedizione=10 where modulo_ordini=v_module;
  insert into public.ordini_testate(data_ordine,stato,modulo_ordini,codice_cliente,ragione_sociale_cliente,stato_sincronizzazione)
   values(current_date,'bozza',v_module,v_customer,'VAT test','non_avviato') returning id into v_order;
  insert into public.ordini_righe(ordine_id,codice_articolo,descrizione,quantita,prezzo_listino,prezzo_netto,imponibile_riga,iva_riga,totale_riga,aliquota_iva,codice_iva_mexal)
   values(v_order,v_code,'VAT test',1,80,80,80,17.6,97.6,22,'22,0');
  perform public.conferma_ordine_workspace(v_order);
  if exists(select 1 from public.ordini_righe where ordine_id=v_order and (not iva_non_applicata or aliquota_iva is not null or codice_iva_mexal is not null or iva_riga<>0)) then raise exception 'Foreign VAT applied in %',v_module;end if;
  if (select totale_documento<>90 or totale_iva<>0 or versione_conferma<>1 from public.ordini_testate where id=v_order) then raise exception 'Incorrect totals/revision';end if;
  insert into public.ordini_email_invio(ordine_id,evento,tipo_destinatario,destinatario,oggetto,versione_conferma,stato)
   values(v_order,'order_confirmed','cliente','test@example.com','test',1,'sent');
  select to_jsonb(o)||jsonb_build_object('stato','bozza') into v_header from public.ordini_testate o where id=v_order;
  select jsonb_agg(to_jsonb(r)||jsonb_build_object('quantita',2,'imponibile_riga',160,'totale_riga',160)) into v_lines from public.ordini_righe r where ordine_id=v_order and not riga_spedizione;
  v_duplicate:=false;
  begin perform public.aggiorna_ordine_operativo(v_order,v_header,v_lines);
  exception when sqlstate 'P0001' then v_duplicate:=true;end;
  if not v_duplicate then raise exception 'Sent order edit allowed';end if;
  if (select versione_conferma from public.ordini_testate where id=v_order)<>1 then raise exception 'Sent revision changed';end if;
  if (select disponibilita from public.ordini_prodotti_cache where codice_articolo=v_code)<>100-array_position(array['prof','ph','private'],v_module) then raise exception 'Sent stock changed';end if;
  if (select count(*) from public.ordini_email_invio where ordine_id=v_order)<>1 then raise exception 'Unexpected email';end if;
 end loop;
 update public.ordini_clienti_cache set paese='IT' where codice_cliente=v_customer;
 update public.ordini_righe set aliquota_iva=22,codice_iva_mexal='22,0',iva_riga=35.2 where ordine_id=v_order and not riga_spedizione;
 if exists(select 1 from public.ordini_righe where ordine_id=v_order and not riga_spedizione and (iva_non_applicata or aliquota_iva<>22)) then raise exception 'Italian VAT lost';end if;
end;$$;
select 'PASS: foreign VAT PROF/PH/Private; shipping; sent edit lock; unchanged stock/email' as result;

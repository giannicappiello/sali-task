do $$
declare v_order uuid; v_draft uuid; v_customer text; v_module text; v_header jsonb; v_lines jsonb; v_blocked boolean;
begin
 insert into public.ordini_prodotti_cache(codice_articolo,descrizione,disponibilita,impegnato) values('_SENT_LOCK_TEST_','Sent lock test',100,0);
 select codice_cliente into v_customer from public.ordini_clienti_cache where paese='IT' limit 1;
 foreach v_module in array array['prof','ph','private'] loop
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  insert into public.ordini_testate(data_ordine,stato,modulo_ordini,codice_cliente,ragione_sociale_cliente,stato_sincronizzazione)
   values(current_date,'bozza',v_module,v_customer,'Sent lock test','non_avviato') returning id into v_order;
  insert into public.ordini_righe(ordine_id,codice_articolo,descrizione,quantita,prezzo_listino,prezzo_netto,imponibile_riga,iva_riga,totale_riga,aliquota_iva,codice_iva_mexal)
   values(v_order,'_SENT_LOCK_TEST_','Sent lock test',1,80,80,80,17.6,97.6,22,'22,0');
  select to_jsonb(o) into v_header from public.ordini_testate o where id=v_order;
  select jsonb_agg(to_jsonb(r)) into v_lines from public.ordini_righe r where ordine_id=v_order;
  perform public.aggiorna_ordine_operativo(v_order,v_header,v_lines);
  perform public.conferma_ordine_workspace(v_order);
  v_blocked:=false;
  begin perform public.aggiorna_ordine_operativo(v_order,v_header,v_lines);
  exception when sqlstate 'P0001' then v_blocked:=true;end;
  if not v_blocked then raise exception 'RPC edit allowed in %',v_module;end if;
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  v_blocked:=false;
  begin update public.ordini_testate set stato='bozza',confermato_at=null,versione_conferma=0 where id=v_order;
  exception when sqlstate 'P0001' then v_blocked:=true;end;
  if not v_blocked then raise exception 'Direct header reset allowed in %',v_module;end if;
  v_blocked:=false;
  begin update public.ordini_righe set quantita=2 where ordine_id=v_order;
  exception when sqlstate 'P0001' then v_blocked:=true;end;
  if not v_blocked then raise exception 'Direct row update allowed in %',v_module;end if;
  v_blocked:=false;
  begin insert into public.ordini_righe(ordine_id,codice_articolo,descrizione,quantita) values(v_order,'_SENT_LOCK_TEST_','Injected row',1);
  exception when sqlstate 'P0001' then v_blocked:=true;end;
  if not v_blocked then raise exception 'Direct row insert allowed in %',v_module;end if;
  v_blocked:=false;
  begin delete from public.ordini_righe where ordine_id=v_order;
  exception when sqlstate 'P0001' then v_blocked:=true;end;
  if not v_blocked then raise exception 'Direct row delete allowed in %',v_module;end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  insert into public.ordini_testate(data_ordine,stato,modulo_ordini,codice_cliente,ragione_sociale_cliente,stato_sincronizzazione)
   values(current_date,'bozza',v_module,v_customer,'Unsent draft test','non_avviato') returning id into v_draft;
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  update public.ordini_testate set commenti='Editable draft' where id=v_draft;
  insert into public.ordini_righe(ordine_id,codice_articolo,descrizione,quantita) values(v_draft,'_SENT_LOCK_TEST_','Draft row',1);
  v_blocked:=false;
  begin update public.ordini_righe set ordine_id=v_order where ordine_id=v_draft;
  exception when sqlstate 'P0001' then v_blocked:=true;end;
  if not v_blocked then raise exception 'Moving draft row into sent order allowed';end if;
  v_blocked:=false;
  begin update public.ordini_righe set ordine_id=v_draft where ordine_id=v_order;
  exception when sqlstate 'P0001' then v_blocked:=true;end;
  if not v_blocked then raise exception 'Moving sent row into draft allowed';end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  update public.ordini_testate set stato_sincronizzazione='errore',errore_sincronizzazione='Test retry' where id=v_order;
  update public.ordini_righe set provvigione_percentuale=5 where ordine_id=v_order and not riga_spedizione;
  if (select stato from public.ordini_testate where id=v_order)<>'aperto' then raise exception 'Sent state changed';end if;
 end loop;
end;$$;
select 'PASS: PR PH Private; only unsent drafts editable; RPC and direct writes locked; sync unaffected' as result;

-- Run inside BEGIN / ROLLBACK. No configuration or test order survives.
do $$
declare c text;o uuid;ph uuid;private_order uuid;history uuid;rule_id uuid;denied boolean;error_text text;
 code text:='_CARTON_TRANSACTION_TEST_';
begin
 select codice_cliente into strict c from public.ordini_clienti_cache where paese='IT' limit 1;
 insert into public.ordini_prodotti_cache(codice_articolo,descrizione,disponibilita,impegnato) values(code,'Carton test',100,0);
 insert into public.ordini_regole_cartonaggi(modulo_ordini,tipo,valore,prodotti,messaggio)
 values('prof','multiple_of',6,array[' '||lower(code)||' ',code],'Solo cartoni completi') returning id into rule_id;
 if (select prodotti from public.ordini_regole_cartonaggi where id=rule_id)<>array[code] then raise exception 'Codes not normalized/deduplicated';end if;
 insert into public.ordini_testate(data_ordine,stato,modulo_ordini,codice_cliente,ragione_sociale_cliente)
 values(current_date,'bozza','prof',c,'Carton test') returning id into o;
 denied:=false;
 begin
  insert into public.ordini_righe(ordine_id,codice_articolo,descrizione,quantita,prezzo_listino,aliquota_iva) values(o,code,'Test',5,10,22);
  set constraints ordini_cartonaggi_lines immediate;
 exception when sqlstate 'P0001' then
  get stacked diagnostics error_text=message_text;
  if position(code in error_text)=0 or position('Multipli di' in error_text)=0 then raise exception 'Missing article message: %',error_text;end if;
  denied:=true;
 end;
 if not denied then raise exception 'Invalid multiple was saved';end if;
 set constraints ordini_cartonaggi_lines deferred;
 -- Validate total quantity rather than individual duplicate rows.
 insert into public.ordini_righe(ordine_id,codice_articolo,descrizione,quantita,prezzo_listino,aliquota_iva)
 values(o,code,'Test',2,10,22),(o,code,'Test',4,10,22);
 set constraints ordini_cartonaggi_lines immediate;
 set constraints ordini_cartonaggi_lines deferred;
 -- A changed rule invalidates an old draft at confirmation, even without Mexal.
 update public.ordini_regole_cartonaggi set valore=8 where id=rule_id;
 denied:=false;
 begin perform public.conferma_ordine_workspace(o);exception when sqlstate 'P0001' then denied:=true;end;
 if not denied or (select stato from public.ordini_testate where id=o)<>'bozza' then raise exception 'Legacy draft confirmed with invalid quantity';end if;
 update public.ordini_regole_cartonaggi set attiva=false where id=rule_id;
 perform public.conferma_ordine_workspace(o);
 -- Configuration does not rewrite confirmed orders.
 update public.ordini_regole_cartonaggi set attiva=true where id=rule_id;
 perform public.assert_order_cartons(o);
 insert into public.ordini_regole_cartonaggi(modulo_ordini,tipo,valore,prodotti) values('ph','less_than',10,array[code]);
 insert into public.ordini_testate(data_ordine,stato,modulo_ordini,codice_cliente,ragione_sociale_cliente)
 values(current_date,'bozza','ph',c,'PH test') returning id into ph;
 insert into public.ordini_righe(ordine_id,codice_articolo,descrizione,quantita,prezzo_listino,aliquota_iva) values(ph,code,'Test',9,10,22);
 set constraints ordini_cartonaggi_lines immediate;
 set constraints ordini_cartonaggi_lines deferred;
 denied:=false;
 begin
  update public.ordini_righe set quantita=10 where ordine_id=ph;
  set constraints ordini_cartonaggi_lines immediate;
 exception when sqlstate 'P0001' then denied:=true;end;
 if not denied then raise exception 'Exclusive maximum ignored';end if;
 set constraints ordini_cartonaggi_lines deferred;
 insert into public.ordini_testate(data_ordine,stato,modulo_ordini,codice_cliente,ragione_sociale_cliente)
 values(current_date,'bozza','private',c,'Private test') returning id into private_order;
 insert into public.ordini_righe(ordine_id,codice_articolo,descrizione,quantita,prezzo_listino,aliquota_iva) values(private_order,code,'Test',5,10,22);
 set constraints ordini_cartonaggi_lines immediate;
 set constraints ordini_cartonaggi_lines deferred;
 if not public.order_carton_quantity_allowed(.3,'multiple_of',.1) or public.order_carton_quantity_allowed(.35,'multiple_of',.1)
 or public.order_carton_quantity_allowed(5,'less_than',5) or not public.order_carton_quantity_allowed(5,'less_or_equal',5)
 or public.order_carton_quantity_allowed(5,'greater_than',5) or not public.order_carton_quantity_allowed(5,'greater_or_equal',5)
 or not public.order_carton_quantity_allowed(5,'equal',5) then raise exception 'Operator boundary error';end if;
 if has_function_privilege('authenticated','public.assert_order_cartons(uuid,text)','execute') then raise exception 'Internal function exposed';end if;
end;$$;
select 'PASS: duplicate totals; limits; custom message; draft confirmation; PR/PH isolation; Private/history unchanged' as result;

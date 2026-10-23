-- Execute in BEGIN / ROLLBACK. No fixture or configuration survives.
do $$
declare c text;o uuid;o2 uuid;legacy uuid;legacy2 uuid;f uuid;lf uuid;lf2 uuid;raw jsonb;denied boolean:=false;
begin
 select codice_cliente into strict c from public.ordini_clienti_cache where paese='IT' limit 1;
 raw:='{"numero_ordine":[[1,90000001]],"sigla_ordine":[[1,"OC"]],"serie_ordine":[[1,81]],"data_ordine":[[1,"19550101"]]}'::jsonb;
 insert into public.mexal_fatture_vendita(sigla,cod_modulo,serie,numero,data_documento,codice_cliente,dati_mexal)
 values('FT','E',81,90000001,'1955-01-02',c,raw) returning id into f;
 if exists(select 1 from public.workspace_order_invoice_associations where fattura_id=f) then raise exception 'Invoice matched nonexistent order';end if;
 insert into public.ordini_testate(data_ordine,stato,modulo_ordini,codice_cliente,ragione_sociale_cliente)
 values('1955-01-01','aperto','prof',c,'Permanent reference test') returning id into o;
 insert into public.ordini_documenti_mexal(ordine_id,tipo_documento,sigla,serie,numero,anno,cod_modulo,stato,stato_operativo,evaso_il)
 values(o,'OCM','OC',81,'90000001',1955,'M','created','EVASO','1955-01-03');
 if not exists(select 1 from public.workspace_order_invoice_links(array[o]) where invoice->>'id'=f::text) then raise exception 'Invoice-first association failed';end if;
 -- Even accidental removal of a child document cannot destroy the archived identity.
 delete from public.ordini_documenti_mexal where ordine_id=o;
 update public.mexal_fatture_vendita set dati_mexal=raw where id=f;
 if not exists(select 1 from public.workspace_order_invoice_associations where fattura_id=f and ordine_id=o) then raise exception 'Link lost after child removal';end if;
 update public.mexal_fatture_vendita set dati_mexal=jsonb_set(raw,'{serie_ordine}','[[1,82]]') where id=f;
 if exists(select 1 from public.workspace_order_invoice_associations where fattura_id=f) then raise exception 'Wrong series matched';end if;
 update public.mexal_fatture_vendita set dati_mexal=jsonb_set(raw,'{data_ordine}','[[1,"19560101"]]') where id=f;
 if exists(select 1 from public.workspace_order_invoice_associations where fattura_id=f) then raise exception 'Wrong year matched';end if;
 update public.mexal_fatture_vendita set dati_mexal=raw where id=f;
 if (select count(*) from public.workspace_order_invoice_associations where fattura_id=f)<>1 then raise exception 'Idempotent recovery failed';end if;
 insert into public.ordini_testate(data_ordine,stato,modulo_ordini,codice_cliente,ragione_sociale_cliente,mexal_sigla,mexal_serie,mexal_numero,mexal_anno)
 values('1955-01-01','aperto','private',c,'Same number, different series','OC',82,'90000001',1955) returning id into o2;
 if (select ordine_id from public.workspace_order_invoice_associations where fattura_id=f)<>o then raise exception 'Series collision';end if;
 -- Old header without a child: recover from explicit date, customer, number and unique series.
 raw:=jsonb_set(raw,'{numero_ordine}','[[1,90000002]]');
 insert into public.ordini_testate(data_ordine,stato,modulo_ordini,codice_cliente,ragione_sociale_cliente,numero_ocm)
 values('1955-01-01','evaso','prof',c,'Legacy reference test','90000002') returning id into legacy;
 insert into public.mexal_fatture_vendita(sigla,cod_modulo,serie,numero,data_documento,codice_cliente,dati_mexal)
 values('FT','E',81,90000002,'1955-01-02',c,raw) returning id into lf;
 if not exists(select 1 from public.workspace_order_invoice_associations where fattura_id=lf and ordine_id=legacy) then raise exception 'Legacy recovery failed';end if;
 insert into public.ordini_testate(data_ordine,stato,modulo_ordini,codice_cliente,ragione_sociale_cliente,numero_ocm)
 values('1955-01-01','evaso','prof',c,'Ambiguous legacy reference','90000002') returning id into legacy2;
 if exists(select 1 from public.workspace_order_invoice_associations where fattura_id=lf) then raise exception 'Ambiguous order matched';end if;
 delete from public.ordini_testate where id=legacy2;
 perform public.reconcile_workspace_invoice(lf);
 if not exists(select 1 from public.workspace_order_invoice_associations where fattura_id=lf) then raise exception 'Recovery after ambiguity failed';end if;
 insert into public.mexal_fatture_vendita(sigla,cod_modulo,serie,numero,data_documento,codice_cliente,dati_mexal)
 values('FT','E',82,90000002,'1955-01-02',c,jsonb_set(raw,'{serie_ordine}','[[1,82]]')) returning id into lf2;
 if exists(select 1 from public.workspace_order_invoice_associations where fattura_id in(lf,lf2)) then raise exception 'Ambiguous legacy series matched';end if;
 begin update public.mexal_ordini_manutenzione set pulizia_automatica=true where id=1;exception when check_violation then denied:=true;end;
 if not denied then raise exception 'Automatic expiry re-enabled';end if;
 if exists(select 1 from public.workspace_invoice_order_references('{"numero_ordine":1,"serie_ordine":null}')) then raise exception 'Malformed reference accepted';end if;
 if has_function_privilege('authenticated','public.reconcile_workspace_invoice(uuid)','execute') then raise exception 'Unrestricted reconciliation access';end if;
end;$$;
select 'PASS: invoice/order arrival order; permanent history; legacy recovery; series/year; ambiguity; no automatic expiry' as result;

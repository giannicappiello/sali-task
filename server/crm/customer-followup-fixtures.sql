create temporary table crm_classified_customers(codice_cliente text,ragione_sociale text,area_crm text,crm_active boolean);
create temporary table crm_order_kpi_source(codice_cliente text,data_ordine date,totale_documento numeric);
create temporary table crm_workflow_settings(crm_tipo text,riordino_giorni_default integer,rischio_moltiplicatore numeric,dormiente_moltiplicatore numeric);
insert into pg_temp.crm_workflow_settings values('b2b',90,1.5,2);
create function pg_temp.crm_has_module_level(text,text) returns boolean language sql as $$select coalesce(current_setting('test.followup_denied',true),'false')<>'true'$$;
insert into pg_temp.crm_classified_customers select code,code,'b2b',true from unnest(array['never','first_old','same_day','recurring','future','boundary','period_empty']) code;
insert into pg_temp.crm_classified_customers values('inactive','inactive','b2b',false),('private','private','conto_terzi',true);
insert into pg_temp.crm_order_kpi_source values
 ('first_old','2026-01-01',10),('same_day','2026-07-31',308.75),('same_day','2026-07-31',978.18),
 ('recurring','2026-06-01',20),('recurring','2026-07-01',30),('recurring','2026-07-01',40),
 ('future','2026-10-01',100),('boundary','2026-06-14',5),('period_empty','2026-07-31',40);
-- CANDIDATE_FUNCTION
do $test$
declare r record;
begin
 if (select count(*) from pg_temp.crm_b2b_followup_worklist('2026-01-01','2026-09-12'))<>7 then raise exception 'Customer base/exclusions failed';end if;
 select * into r from pg_temp.crm_b2b_followup_worklist('2026-01-01','2026-09-12') where codice_cliente='never';
 if r.categoria<>'da_attivare' or r.numero_ordini<>0 or r.contatto_consigliato_il<>'2026-09-12' then raise exception 'Never ordered omitted';end if;
 select * into r from pg_temp.crm_b2b_followup_worklist('2026-01-01','2026-09-12') where codice_cliente='first_old';
 if r.categoria<>'primo_ordine_senza_seguito' or r.classificazione<>'perso' then raise exception 'First order stayed new forever';end if;
 select * into r from pg_temp.crm_b2b_followup_worklist('2026-01-01','2026-09-12') where codice_cliente='same_day';
 if r.frequenza_usata_giorni<>90 or r.giornate_acquisto<>1 or r.numero_ordini<>2 or r.categoria is not null or r.riordino_atteso_il<>'2026-10-29' or r.ordinato_periodo<>1286.93 then raise exception 'Same-day cadence failed: %',row_to_json(r);end if;
 select * into r from pg_temp.crm_b2b_followup_worklist('2026-07-01','2026-07-31') where codice_cliente='recurring';
 if r.frequenza_usata_giorni<>30 or r.numero_ordini<>3 or r.ordinato_periodo<>70 or r.ordini_periodo<>2 or r.categoria is not null then raise exception 'Period inclusive/cadence failed';end if;
 select * into r from pg_temp.crm_b2b_followup_worklist('2026-01-01','2026-09-12') where codice_cliente='recurring';
 if r.classificazione<>'perso' or r.categoria<>'riordino_in_ritardo' then raise exception 'Recurring overdue failed';end if;
 select * into r from pg_temp.crm_b2b_followup_worklist('2026-01-01','2026-09-12') where codice_cliente='future';
 if r.numero_ordini<>0 or r.ordinato_periodo<>0 then raise exception 'Future orders leaked into historical evaluation';end if;
 select * into r from pg_temp.crm_b2b_followup_worklist('2026-09-01','2026-09-12') where codice_cliente='period_empty';
 if r.categoria<>'nessun_ordine_periodo' or r.numero_ordini<>1 or r.ordini_periodo<>0 then raise exception 'Period absence confused with never ordered';end if;
 select * into r from pg_temp.crm_b2b_followup_worklist('2026-01-01','2026-09-12') where codice_cliente='boundary';
 if r.classificazione<>'primo_ordine' then raise exception 'Exact 90-day boundary failed';end if;
 begin perform * from pg_temp.crm_b2b_followup_worklist('2026-09-12','2026-01-01');raise exception 'Invalid range accepted';exception when sqlstate '22023' then null;end;
 perform set_config('test.followup_denied','true',true);
 begin perform * from pg_temp.crm_b2b_followup_worklist('2026-01-01','2026-09-12');raise exception 'Permission denied bypassed';exception when sqlstate '42501' then null;end;
 perform set_config('test.followup_denied','false',true);
 delete from pg_temp.crm_workflow_settings;
 select * into r from pg_temp.crm_b2b_followup_worklist('2026-01-01','2026-09-12') where codice_cliente='same_day';
 if r.frequenza_usata_giorni<>90 then raise exception 'Missing settings fallback failed';end if;
end $test$;
select '12 SQL follow-up assertions passed' result;

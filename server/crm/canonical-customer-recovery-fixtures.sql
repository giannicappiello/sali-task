create temporary table ordini_clienti_cache(codice_cliente text primary key,attivo_mexal boolean,sync_excluded boolean,
  cod_alternativo text,nome_ricerca_cf text,crm_restored_area text,crm_restore_reference text);
create temporary table crm_customer_classifications(codice_cliente text primary key,area_automatica text,
  agente_classificazione text,origine_classificazione text,classificata_il timestamptz,aggiornata_il timestamptz,
  area_override text,override_da uuid,override_il timestamptz,override_note text,
  area_crm text generated always as (coalesce(area_override,area_automatica)) stored);
create function pg_temp.crm_customer_area_from_mexal_fields(text,text) returns text language sql as $$
 select public.crm_customer_area_from_mexal_fields($1,$2);
$$;
create function pg_temp.workspace_user_is_admin() returns boolean language sql as $$ select false; $$;

-- CANDIDATE FUNCTIONS

create trigger clear_recovery before insert or update of cod_alternativo,nome_ricerca_cf on pg_temp.ordini_clienti_cache
for each row execute function pg_temp.crm_clear_recovered_customer_area();
do $tests$
declare n integer;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  insert into pg_temp.ordini_clienti_cache values
    ('restored',true,false,null,null,'b2b','test-audit'),
    ('unknown',true,false,null,null,null,null),
    ('excluded',true,true,null,null,'b2b','test-audit'),
    ('inactive',false,false,null,null,'b2b','test-audit'),
    ('private',true,false,'PRIVATE',null,null,null);
  perform pg_temp.crm_refresh_customer_classification('restored');
  if not exists(select 1 from pg_temp.crm_customer_classifications where codice_cliente='restored' and area_crm='b2b' and origine_classificazione='reactivation_history') then raise exception 'Historical recovery failed'; end if;
  perform pg_temp.crm_refresh_customer_classifications();
  select count(*) into n from pg_temp.crm_customer_classifications;
  if n<>2 then raise exception 'Bulk refresh dropped recovery or classified unknown/excluded/inactive customers'; end if;
  update pg_temp.ordini_clienti_cache set cod_alternativo=null,nome_ricerca_cf='' where codice_cliente='restored';
  perform pg_temp.crm_refresh_customer_classification('restored');
  if not exists(select 1 from pg_temp.crm_customer_classifications where codice_cliente='restored' and area_crm='b2b') then raise exception 'Blank sync erased recovery'; end if;
  update pg_temp.ordini_clienti_cache set cod_alternativo='DIRECT',nome_ricerca_cf='BTOC' where codice_cliente='restored';
  perform pg_temp.crm_refresh_customer_classification('restored');
  if not exists(select 1 from pg_temp.crm_customer_classifications where codice_cliente='restored' and area_crm='online' and origine_classificazione='mexal_fields') then raise exception 'Mexal did not take precedence'; end if;
  if exists(select 1 from pg_temp.ordini_clienti_cache where codice_cliente='restored' and (crm_restored_area is not null or crm_restore_reference is not null)) then raise exception 'Stale recovery retained'; end if;
  update pg_temp.ordini_clienti_cache set cod_alternativo=null,nome_ricerca_cf=null where codice_cliente='restored';
  perform pg_temp.crm_refresh_customer_classification('restored');
  if exists(select 1 from pg_temp.crm_customer_classifications where codice_cliente='restored') then raise exception 'Old recovery resurrected'; end if;
  if pg_temp.crm_customer_effective_area('OTHER','BTOB','b2b') is not null then raise exception 'Unknown explicit classification silently overridden'; end if;
  if pg_temp.crm_customer_effective_area('DIRECT',null,'b2b') is not null then raise exception 'Incomplete explicit classification silently overridden'; end if;
  update pg_temp.ordini_clienti_cache set attivo_mexal=false where codice_cliente='private';
  perform pg_temp.crm_refresh_customer_classification('private');
  if exists(select 1 from pg_temp.crm_customer_classifications) then raise exception 'Deactivated customer still classified'; end if;
end $tests$;
select '9 canonical recovery assertions passed' result;

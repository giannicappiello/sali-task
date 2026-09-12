begin;

-- Keep the historical recovery on the existing canonical customer, not in a
-- second directory and never in fields represented as imported Mexal values.
alter table public.ordini_clienti_cache
  add column crm_restored_area text check (crm_restored_area in ('conto_terzi','b2b','online')),
  add column crm_restore_reference text,
  add constraint crm_customer_restore_provenance check (
    (crm_restored_area is null and crm_restore_reference is null)
    or (crm_restored_area is not null and nullif(btrim(crm_restore_reference),'') is not null)
  );
comment on column public.ordini_clienti_cache.crm_restored_area is
  'CRM area recovered from the audit of an explicitly authorized customer reactivation; used only while both Mexal classification fields are blank.';

alter table public.crm_customer_classifications
  drop constraint crm_customer_classifications_origine_classificazione_check;
alter table public.crm_customer_classifications
  add constraint crm_customer_classifications_origine_classificazione_check
  check (origine_classificazione in ('mexal_fields','reactivation_history'));

create or replace function public.crm_customer_effective_area(alternative_code text, search_name text, restored_area text)
returns text language sql immutable parallel safe set search_path=public as $$
  select case when nullif(btrim(alternative_code),'') is null and nullif(btrim(search_name),'') is null
    then case when restored_area in ('conto_terzi','b2b','online') then restored_area end
    else public.crm_customer_area_from_mexal_fields(alternative_code,search_name) end;
$$;

-- An explicit subsequent Mexal classification replaces the recovery, even if
-- it is invalid/unclassified. Clearing it later must not resurrect stale data.
create function public.crm_clear_recovered_customer_area()
returns trigger language plpgsql set search_path=public as $$
begin
  if nullif(btrim(new.cod_alternativo),'') is not null or nullif(btrim(new.nome_ricerca_cf),'') is not null then
    new.crm_restored_area:=null;
    new.crm_restore_reference:=null;
  end if;
  return new;
end;
$$;
create trigger crm_clear_recovered_customer_area before insert or update of cod_alternativo,nome_ricerca_cf
on public.ordini_clienti_cache for each row execute function public.crm_clear_recovered_customer_area();

create or replace function public.crm_refresh_customer_classification(target_customer_code text)
returns void language plpgsql security definer set search_path=public as $$
declare next_area text; next_origin text;
begin
  select case when c.attivo_mexal is true and c.sync_excluded is false then
    public.crm_customer_effective_area(c.cod_alternativo,c.nome_ricerca_cf,c.crm_restored_area) end,
    case when nullif(btrim(c.cod_alternativo),'') is null and nullif(btrim(c.nome_ricerca_cf),'') is null
      and c.crm_restored_area is not null then 'reactivation_history' else 'mexal_fields' end
  into next_area,next_origin from public.ordini_clienti_cache c where c.codice_cliente=target_customer_code;
  if not found or next_area is null then
    delete from public.crm_customer_classifications where codice_cliente=target_customer_code;
    return;
  end if;
  insert into public.crm_customer_classifications(codice_cliente,area_automatica,agente_classificazione,origine_classificazione,classificata_il,aggiornata_il)
  values(target_customer_code,next_area,null,next_origin,now(),now())
  on conflict(codice_cliente) do update set area_automatica=excluded.area_automatica,
    agente_classificazione=null,origine_classificazione=excluded.origine_classificazione,
    area_override=null,override_da=null,override_il=null,override_note=null,
    classificata_il=case when crm_customer_classifications.area_automatica is distinct from excluded.area_automatica
      then now() else crm_customer_classifications.classificata_il end,aggiornata_il=now();
end;
$$;

create or replace function public.crm_refresh_customer_classifications()
returns table(processed bigint,conto_terzi bigint,b2b bigint,online bigint,unclassified bigint)
language plpgsql security definer set search_path=public as $$
begin
  if auth.role()<>'service_role' and not public.workspace_user_is_admin() then
    raise exception 'Solo un Amministratore Workspace può popolare le classificazioni CRM.' using errcode='42501';
  end if;
  delete from public.crm_customer_classifications;
  insert into public.crm_customer_classifications(codice_cliente,area_automatica,agente_classificazione,origine_classificazione,classificata_il,aggiornata_il)
  select c.codice_cliente,public.crm_customer_effective_area(c.cod_alternativo,c.nome_ricerca_cf,c.crm_restored_area),null,
    case when nullif(btrim(c.cod_alternativo),'') is null and nullif(btrim(c.nome_ricerca_cf),'') is null
      and c.crm_restored_area is not null then 'reactivation_history' else 'mexal_fields' end,now(),now()
  from public.ordini_clienti_cache c where c.attivo_mexal is true and c.sync_excluded is false
    and public.crm_customer_effective_area(c.cod_alternativo,c.nome_ricerca_cf,c.crm_restored_area) is not null;
  return query
  with active as (select count(*)::bigint total from public.ordini_clienti_cache where attivo_mexal is true and sync_excluded is false),
  classified as (select count(*)::bigint total,count(*) filter(where area_crm='conto_terzi')::bigint ct,
    count(*) filter(where area_crm='b2b')::bigint bt,count(*) filter(where area_crm='online')::bigint ol
    from public.crm_customer_classifications)
  select a.total,c.ct,c.bt,c.ol,greatest(a.total-c.total,0)::bigint from active a cross join classified c;
end;
$$;

-- Changes to the recovery itself must rebuild the same canonical projection.
create trigger crm_classify_customer_after_recovery after update of crm_restored_area,crm_restore_reference
on public.ordini_clienti_cache for each row execute function public.crm_classify_customer_after_mexal_sync();

-- Recover only the 23 already reactivated customers from their preserved audit.
-- No names, customer lists, source-file imports or agent assignments are invented.
do $restore$
declare target record; restored_count integer:=0; audit_count integer;
begin
  select count(distinct dettagli->>'customer_key') into audit_count from public.crm_audit_log
  where operazione='customer_reactivated' and dettagli->>'request_reference'='codex-20260912-reactivate-exact-23';
  if audit_count not in (0,23) then raise exception 'Unexpected reactivation audit count: %',audit_count; end if;
  for target in
    select distinct on (a.dettagli->>'customer_key') substr(a.dettagli->>'customer_key',7) code,
      a.dettagli->'previous_exclusion'->'snapshot'->>'area_crm' area
    from public.crm_audit_log a where a.operazione='customer_reactivated'
      and a.dettagli->>'request_reference'='codex-20260912-reactivate-exact-23'
    order by a.dettagli->>'customer_key',a.creato_il desc
  loop
    if target.area not in ('conto_terzi','b2b','online') or target.area is null then
      raise exception 'Missing historical CRM area'; end if;
    if not exists(select 1 from public.ordini_clienti_cache c join public.crm_customer_status s on s.customer_key='mexal:'||c.codice_cliente
      where c.codice_cliente=target.code and c.attivo_mexal is true and c.sync_excluded is false and s.crm_active is true
      and not exists(select 1 from public.workspace_mexal_customer_exclusions e where e.codice_cliente=c.codice_cliente)) then
      raise exception 'Reactivated customer state changed: %',target.code; end if;
    update public.ordini_clienti_cache set crm_restored_area=target.area,
      crm_restore_reference='codex-20260912-reactivate-exact-23'
    where codice_cliente=target.code and nullif(btrim(cod_alternativo),'') is null and nullif(btrim(nome_ricerca_cf),'') is null;
    perform public.crm_refresh_customer_classification(target.code);
    if not exists(select 1 from public.crm_customer_classifications where codice_cliente=target.code) then
      raise exception 'Customer has no effective CRM classification: %',target.code; end if;
    insert into public.crm_audit_log(utente_id,entita_tipo,entita_id,operazione,dettagli)
    values(null,'crm_customer_status',null,'customer_crm_classification_restored',
      jsonb_build_object('customer_key','mexal:'||target.code,'historical_area',target.area,
        'request_reference','codex-20260912-reactivate-exact-23','mexal_modified',false,
        'reason','Ripristino autorizzato della classificazione CRM storica sulla medesima anagrafica canonica.'));
    restored_count:=restored_count+1;
  end loop;
  if restored_count<>audit_count then raise exception 'Incomplete customer recovery'; end if;
end $restore$;

revoke all on function public.crm_clear_recovered_customer_area() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;

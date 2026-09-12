begin;

-- L'area CRM continua a dipendere esclusivamente dai campi Mexal
-- cod_alternativo/nome_ricerca_cf. Il responsabile mostrato nelle liste,
-- invece, deve seguire il codice agente assegnato al cliente in Mexal.
create or replace function public.crm_refresh_customer_classification(target_customer_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_area text;
  next_origin text;
  current_agent text;
begin
  select
    case when customer.attivo_mexal is true and customer.sync_excluded is false then
      public.crm_customer_effective_area(customer.cod_alternativo, customer.nome_ricerca_cf, customer.crm_restored_area)
    end,
    case when nullif(btrim(customer.cod_alternativo), '') is null
      and nullif(btrim(customer.nome_ricerca_cf), '') is null
      and customer.crm_restored_area is not null
      then 'reactivation_history' else 'mexal_fields' end,
    public.crm_customer_agent_label(customer.codice_agente_mexal)
  into next_area, next_origin, current_agent
  from public.ordini_clienti_cache customer
  where customer.codice_cliente = target_customer_code;

  if not found or next_area is null then
    delete from public.crm_customer_classifications
    where codice_cliente = target_customer_code;
    return;
  end if;

  insert into public.crm_customer_classifications (
    codice_cliente, area_automatica, agente_classificazione,
    origine_classificazione, classificata_il, aggiornata_il
  ) values (
    target_customer_code, next_area, nullif(btrim(current_agent), ''),
    next_origin, now(), now()
  )
  on conflict (codice_cliente) do update set
    area_automatica = excluded.area_automatica,
    agente_classificazione = excluded.agente_classificazione,
    origine_classificazione = excluded.origine_classificazione,
    area_override = null,
    override_da = null,
    override_il = null,
    override_note = null,
    classificata_il = case
      when crm_customer_classifications.area_automatica is distinct from excluded.area_automatica
        or crm_customer_classifications.agente_classificazione is distinct from excluded.agente_classificazione
        or crm_customer_classifications.origine_classificazione is distinct from excluded.origine_classificazione
      then now() else crm_customer_classifications.classificata_il end,
    aggiornata_il = now();
end;
$$;

create or replace function public.crm_refresh_customer_classifications()
returns table(processed bigint, conto_terzi bigint, b2b bigint, online bigint, unclassified bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not public.workspace_user_is_admin() then
    raise exception 'Solo un Amministratore Workspace può popolare le classificazioni CRM.' using errcode = '42501';
  end if;

  delete from public.crm_customer_classifications;
  insert into public.crm_customer_classifications (
    codice_cliente, area_automatica, agente_classificazione,
    origine_classificazione, classificata_il, aggiornata_il
  )
  select
    customer.codice_cliente,
    public.crm_customer_effective_area(customer.cod_alternativo, customer.nome_ricerca_cf, customer.crm_restored_area),
    public.crm_customer_agent_label(customer.codice_agente_mexal),
    case when nullif(btrim(customer.cod_alternativo), '') is null
      and nullif(btrim(customer.nome_ricerca_cf), '') is null
      and customer.crm_restored_area is not null
      then 'reactivation_history' else 'mexal_fields' end,
    now(), now()
  from public.ordini_clienti_cache customer
  where customer.attivo_mexal is true
    and customer.sync_excluded is false
    and public.crm_customer_effective_area(customer.cod_alternativo, customer.nome_ricerca_cf, customer.crm_restored_area) is not null;

  return query
  with active as (
    select count(*)::bigint total from public.ordini_clienti_cache
    where attivo_mexal is true and sync_excluded is false
  ), classified as (
    select count(*)::bigint total,
      count(*) filter(where area_crm = 'conto_terzi')::bigint ct,
      count(*) filter(where area_crm = 'b2b')::bigint bt,
      count(*) filter(where area_crm = 'online')::bigint ol
    from public.crm_customer_classifications
  )
  select active.total, classified.ct, classified.bt, classified.ol,
    greatest(active.total - classified.total, 0)::bigint
  from active cross join classified;
end;
$$;

-- Corregge immediatamente i clienti già classificati senza attendere una
-- nuova sincronizzazione Mexal.
update public.crm_customer_classifications classification
set agente_classificazione = public.crm_customer_agent_label(customer.codice_agente_mexal),
    aggiornata_il = now()
from public.ordini_clienti_cache customer
where customer.codice_cliente = classification.codice_cliente
  and classification.agente_classificazione is distinct from
      public.crm_customer_agent_label(customer.codice_agente_mexal);

-- Mantiene il responsabile aggiornato anche quando cambia solo l'agente del
-- cliente, senza alterare la regola che determina l'area CRM.
drop trigger if exists crm_classify_customer_after_mexal_sync on public.ordini_clienti_cache;
create trigger crm_classify_customer_after_mexal_sync
after insert or update of cod_alternativo, nome_ricerca_cf, attivo_mexal, codice_agente_mexal
on public.ordini_clienti_cache
for each row execute function public.crm_classify_customer_after_mexal_sync();

comment on function public.crm_refresh_customer_classification(text) is
  'Classifica l area CRM dai campi Mexal e aggiorna separatamente il nome agente responsabile.';

commit;

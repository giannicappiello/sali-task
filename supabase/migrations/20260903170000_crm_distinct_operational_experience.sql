-- CRM PRIVATE / B2B: worklist operative distinte sul core CRM condiviso.
-- Migrazione additiva e read-only sui dati esistenti: nessun account, attivita,
-- opportunita, progetto o ordine viene aggiornato o cancellato.

create or replace function public.crm_b2b_customer_worklist()
returns table (
  codice_cliente text,
  ragione_sociale text,
  classificazione text,
  numero_ordini bigint,
  valore_ordini numeric,
  primo_ordine_il date,
  ultimo_ordine_il date,
  frequenza_media_giorni numeric,
  riordino_atteso_il date,
  giorni_da_ultimo_ordine integer
)
language plpgsql stable security invoker set search_path=public as $$
declare v_settings public.crm_workflow_settings%rowtype;
begin
  if not public.crm_has_module_level('crm_b2b','lettura') then
    raise exception 'Accesso CRM B2B non autorizzato';
  end if;
  select * into v_settings from public.crm_workflow_settings where crm_tipo='b2b';
  return query
  with customers as (
    select c.codice_cliente,c.ragione_sociale
    from public.crm_classified_customers c
    where c.area_crm='b2b' and c.crm_active
  ), dates as (
    select c.codice_cliente,c.ragione_sociale,o.data_ordine,o.totale_documento,
      lag(o.data_ordine) over(partition by c.codice_cliente order by o.data_ordine) previous_date
    from customers c left join public.crm_order_kpi_source o on o.codice_cliente=c.codice_cliente
  ), stats as (
    select d.codice_cliente,d.ragione_sociale,count(d.data_ordine)::bigint order_count,
      coalesce(sum(d.totale_documento),0)::numeric order_value,min(d.data_ordine) first_date,max(d.data_ordine) last_date,
      avg(d.data_ordine-d.previous_date) filter(where d.previous_date is not null) average_days
    from dates d group by d.codice_cliente,d.ragione_sociale
  )
  select s.codice_cliente,s.ragione_sociale,
    case when s.order_count=0 then 'prospect'
      when s.order_count=1 then 'primo_ordine'
      when s.last_date>=current_date-coalesce(round(s.average_days)::int,v_settings.riordino_giorni_default) then 'attivo'
      when s.last_date>=current_date-(coalesce(round(s.average_days)::int,v_settings.riordino_giorni_default)*v_settings.rischio_moltiplicatore)::int then 'a_rischio'
      when s.last_date>=current_date-(coalesce(round(s.average_days)::int,v_settings.riordino_giorni_default)*v_settings.dormiente_moltiplicatore)::int then 'dormiente'
      else 'perso' end,
    s.order_count,s.order_value,s.first_date,s.last_date,round(s.average_days::numeric,1),
    s.last_date+coalesce(round(s.average_days)::int,v_settings.riordino_giorni_default),
    case when s.last_date is null then null else current_date-s.last_date end
  from stats s order by s.last_date nulls first,s.ragione_sociale;
end; $$;

create or replace function public.crm_b2b_first_order_suggestions()
returns table (
  opportunity_id uuid,
  opportunity_title text,
  account_id uuid,
  customer_code text,
  customer_name text,
  first_order_date date,
  first_order_value numeric
)
language plpgsql stable security invoker set search_path=public as $$
begin
  if not public.crm_has_module_level('crm_b2b','lettura') then
    raise exception 'Accesso CRM B2B non autorizzato';
  end if;
  return query
  with first_orders as (
    select distinct on (o.codice_cliente) o.codice_cliente,o.data_ordine,o.totale_documento
    from public.crm_order_kpi_source o
    where o.codice_cliente is not null
    order by o.codice_cliente,o.data_ordine,o.id
  )
  select op.id,op.titolo,a.id,a.codice_cliente_mexal,a.nome,fo.data_ordine,fo.totale_documento
  from public.crm_opportunities op
  join public.crm_accounts a on a.id=op.account_id and a.tipo='b2b'
  join first_orders fo on fo.codice_cliente=a.codice_cliente_mexal
  left join public.crm_opportunity_stages stage on stage.id=op.stage_id
  where not coalesce(stage.finale,false)
    and op.ordine_collegato_id is null
    and fo.data_ordine>=coalesce(op.aperta_il,op.creato_il::date)
  order by fo.data_ordine desc,a.nome;
end; $$;

revoke all on function public.crm_b2b_customer_worklist(), public.crm_b2b_first_order_suggestions() from public,anon;
grant execute on function public.crm_b2b_customer_worklist(), public.crm_b2b_first_order_suggestions() to authenticated,service_role;

comment on function public.crm_b2b_customer_worklist() is 'Classificazione dinamica B2B server-side derivata dallo storico ordini canonico, senza modificare lo stato CRM.';
comment on function public.crm_b2b_first_order_suggestions() is 'Rileva opportunita B2B aperte con primo ordine Mexal successivo all apertura; la chiusura resta una conferma utente.';

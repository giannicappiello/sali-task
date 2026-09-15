begin;

-- Drill-down uses the same source, thresholds and current-date semantics as
-- crm_b2b_lifecycle_summary, without changing its established KPI calculation.
create or replace function public.crm_b2b_lifecycle_details()
returns table(codice_cliente text,ragione_sociale text,classificazione text,
  numero_ordini bigint,ultimo_ordine_il date,frequenza_media_giorni numeric,
  contatto_consigliato_il date)
language plpgsql stable security invoker set search_path=public as $$
declare settings public.crm_workflow_settings%rowtype;
begin
  if not public.crm_has_module_level('crm_b2b','lettura') then
    raise exception 'Accesso CRM B2B non autorizzato' using errcode='42501';
  end if;
  select * into settings from public.crm_workflow_settings where crm_tipo='b2b';
  return query
  with customers as (
    select c.codice_cliente,c.ragione_sociale from public.crm_classified_customers c
    where c.area_crm='b2b' and c.crm_active
  ), dates as (
    select c.codice_cliente,c.ragione_sociale,o.data_ordine,
      lag(o.data_ordine) over(partition by c.codice_cliente order by o.data_ordine) previous_date
    from customers c left join public.crm_order_kpi_source o on o.codice_cliente=c.codice_cliente
  ), stats as (
    select d.codice_cliente,d.ragione_sociale,count(d.data_ordine)::bigint order_count,
      max(d.data_ordine) last_date,avg(d.data_ordine-d.previous_date) filter(where d.previous_date is not null) average_days
    from dates d group by d.codice_cliente,d.ragione_sociale
  )
  select s.codice_cliente,s.ragione_sociale,
    case when s.order_count=0 then 'prospect' when s.order_count=1 then 'primo_ordine'
      when s.last_date>=current_date-coalesce(round(s.average_days)::int,settings.riordino_giorni_default) then 'riordino'
      when s.last_date>=current_date-(coalesce(round(s.average_days)::int,settings.riordino_giorni_default)*settings.rischio_moltiplicatore)::int then 'a_rischio'
      when s.last_date>=current_date-(coalesce(round(s.average_days)::int,settings.riordino_giorni_default)*settings.dormiente_moltiplicatore)::int then 'dormiente'
      else 'perso' end,
    s.order_count,s.last_date,round(s.average_days::numeric,1),
    s.last_date+coalesce(round(s.average_days)::int,settings.riordino_giorni_default)
  from stats s order by s.ragione_sociale,s.codice_cliente;
end;
$$;
revoke all on function public.crm_b2b_lifecycle_details() from public,anon;
grant execute on function public.crm_b2b_lifecycle_details() to authenticated,service_role;
notify pgrst,'reload schema';
commit;

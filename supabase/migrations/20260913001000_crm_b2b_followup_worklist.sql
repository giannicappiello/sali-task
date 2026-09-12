begin;

-- Read-only projection of the canonical customer/order sources, under caller RLS.
-- History is evaluated at the end of the selected period; no CRM status is written.
create function public.crm_b2b_followup_worklist(period_from date, period_to date)
returns table (
  codice_cliente text, ragione_sociale text, classificazione text,
  numero_ordini bigint, valore_ordini numeric, ultimo_ordine_il date,
  giornate_acquisto bigint, frequenza_media_giorni numeric, frequenza_usata_giorni integer,
  riordino_atteso_il date, giorni_da_ultimo_ordine integer,
  ordini_periodo bigint, ordinato_periodo numeric,
  categoria text, motivo text, contatto_consigliato_il date, priorita integer
)
language plpgsql stable security invoker set search_path=public as $worklist$
declare default_days integer; risk_multiplier numeric; dormant_multiplier numeric;
begin
  if not public.crm_has_module_level('crm_b2b','lettura') then
    raise exception 'Accesso CRM B2B non autorizzato' using errcode='42501';
  end if;
  if period_from is null or period_to is null or period_from>period_to then
    raise exception 'Periodo CRM non valido' using errcode='22023';
  end if;
  select greatest(coalesce(s.riordino_giorni_default,90),1),
    greatest(coalesce(s.rischio_moltiplicatore,1.5),1),
    greatest(coalesce(s.dormiente_moltiplicatore,2),coalesce(s.rischio_moltiplicatore,1.5),1)
  into default_days,risk_multiplier,dormant_multiplier
  from public.crm_workflow_settings s where s.crm_tipo='b2b';
  default_days:=coalesce(default_days,90);
  risk_multiplier:=coalesce(risk_multiplier,1.5);
  dormant_multiplier:=coalesce(dormant_multiplier,2);
  return query
  with customers as materialized (
    select c.codice_cliente,c.ragione_sociale from public.crm_classified_customers c
    where c.area_crm='b2b' and c.crm_active
  ), orders as materialized (
    select o.codice_cliente,o.data_ordine::date purchase_date,o.totale_documento
    from public.crm_order_kpi_source o join customers c on c.codice_cliente=o.codice_cliente
    where o.data_ordine<=period_to
  ), daily as (
    select o.codice_cliente,o.purchase_date,count(*) document_count,sum(o.totale_documento) document_value
    from orders o group by o.codice_cliente,o.purchase_date
  ), intervals as (
    select d.*,d.purchase_date-lag(d.purchase_date) over(partition by d.codice_cliente order by d.purchase_date) gap from daily d
  ), stats as (
    select c.codice_cliente,c.ragione_sociale,
      coalesce(sum(d.document_count),0)::bigint order_count,
      coalesce(sum(d.document_value),0)::numeric order_value,
      count(d.purchase_date) day_count,max(d.purchase_date) last_date,avg(d.gap) average_days,
      coalesce(sum(d.document_count) filter(where d.purchase_date>=period_from),0)::bigint period_count,
      coalesce(sum(d.document_value) filter(where d.purchase_date>=period_from),0)::numeric period_value
    from customers c left join intervals d on d.codice_cliente=c.codice_cliente
    group by c.codice_cliente,c.ragione_sociale
  ), timing as (
    select s.*,greatest(coalesce(round(s.average_days)::int,default_days),1) cadence
    from stats s
  ), segmented as (
    select t.*,t.last_date+t.cadence due_date,
      case when t.order_count=0 then 'prospect'
        when period_to>t.last_date+round(t.cadence*dormant_multiplier)::int then 'perso'
        when period_to>t.last_date+round(t.cadence*risk_multiplier)::int then 'dormiente'
        when period_to>t.last_date+t.cadence then 'a_rischio'
        when t.day_count=1 then 'primo_ordine' else 'attivo' end segment,
      case when t.order_count=0 then 'da_attivare'
        when period_to>t.last_date+t.cadence and t.day_count=1 then 'primo_ordine_senza_seguito'
        when period_to>t.last_date+t.cadence then 'riordino_in_ritardo'
        when t.period_count=0 then 'nessun_ordine_periodo' end category
    from timing t
  )
  select s.codice_cliente,s.ragione_sociale,s.segment,s.order_count,s.order_value,s.last_date,
    s.day_count,round(s.average_days::numeric,1),s.cadence,s.due_date,period_to-s.last_date,
    s.period_count,s.period_value,s.category,
    case s.category
      when 'da_attivare' then 'Nessun ordine nello storico disponibile fino alla data finale: primo contatto commerciale.'
      when 'primo_ordine_senza_seguito' then 'Una sola giornata di acquisto; soglia di riordino superata di '||(period_to-s.due_date)||' giorni.'
      when 'riordino_in_ritardo' then 'Riordino atteso da '||(period_to-s.due_date)||' giorni.'
      when 'nessun_ordine_periodo' then 'Nessun ordine nel periodo selezionato; acquisti precedenti presenti e riordino non ancora scaduto.'
      else 'Riordino non ancora scaduto.' end,
    case when s.order_count=0 then period_to else s.due_date end,
    case when s.segment='perso' then 1 when s.segment='dormiente' then 2
      when s.segment='a_rischio' then 3 when s.category='da_attivare' then 4
      when s.category='nessun_ordine_periodo' then 5 else 6 end
  from segmented s
  order by 17,16,s.ragione_sociale,s.codice_cliente;
end $worklist$;
revoke all on function public.crm_b2b_followup_worklist(date,date) from public,anon;
grant execute on function public.crm_b2b_followup_worklist(date,date) to authenticated,service_role;
comment on function public.crm_b2b_followup_worklist(date,date) is
  'Single customer worklist: distinct purchase days, historical segmentation as of period end, period order totals, no source mutations, caller RLS.';
notify pgrst,'reload schema';
commit;

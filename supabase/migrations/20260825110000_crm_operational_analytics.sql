begin;

-- Analytics CRM operativi. Le funzioni sono SECURITY DEFINER per aggregare le
-- sorgenti Mexal senza concederle direttamente, ma applicano sempre lo stesso
-- predicato di visibilita del catalogo clienti classificato.
create or replace function public.crm_dashboard_metrics(
  p_crm_type text,
  p_from date,
  p_to date,
  p_inactivity_days integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_crm_type not in ('conto_terzi', 'b2b', 'online') then
    raise exception 'Area CRM non valida.' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Intervallo CRM non valido.' using errcode = '22023';
  end if;
  if not public.crm_has_module_level(public.crm_module_for_type(p_crm_type), 'lettura')
     and auth.role() <> 'service_role' then
    raise exception 'Accesso CRM non autorizzato.' using errcode = '42501';
  end if;

  with visible_customers as (
    select c.codice_cliente, c.attivo_mexal
    from public.crm_customer_classifications x
    join public.ordini_clienti_cache c using (codice_cliente)
    where x.area_crm = p_crm_type
      and public.crm_customer_classification_visible(x.codice_cliente, x.area_crm)
  ), invoice_by_customer as (
    select f.codice_cliente,
      count(*) filter (where f.data_documento between p_from and p_to)::bigint invoice_count,
      coalesce(sum(f.totale_documento) filter (where f.data_documento between p_from and p_to), 0)::numeric invoice_total,
      min(f.data_documento) first_invoice,
      max(f.data_documento) last_invoice
    from public.mexal_fatture_vendita f
    join visible_customers v using (codice_cliente)
    group by f.codice_cliente
  ), order_by_customer as (
    select o.codice_cliente,
      count(*) filter (where o.data_ordine between p_from and p_to)::bigint order_count,
      coalesce(sum(o.totale_documento) filter (where o.data_ordine between p_from and p_to), 0)::numeric order_total,
      min(o.data_ordine) first_order,
      max(o.data_ordine) last_order
    from public.ordini_testate o
    join visible_customers v using (codice_cliente)
    group by o.codice_cliente
  ), customer_metrics as (
    select v.codice_cliente, v.attivo_mexal,
      coalesce(i.invoice_count, 0) invoice_count,
      coalesce(i.invoice_total, 0) invoice_total,
      i.first_invoice, i.last_invoice,
      coalesce(o.order_count, 0) order_count,
      coalesce(o.order_total, 0) order_total,
      o.first_order, o.last_order,
      greatest(i.last_invoice, o.last_order) last_commercial_activity
    from visible_customers v
    left join invoice_by_customer i using (codice_cliente)
    left join order_by_customer o using (codice_cliente)
  ), customer_totals as (
    select
      count(*)::bigint customers,
      count(*) filter (where attivo_mexal)::bigint active_customers,
      count(*) filter (where invoice_count > 0 or order_count > 0)::bigint customers_with_activity,
      count(*) filter (where order_count > 0)::bigint customers_with_orders,
      count(*) filter (where invoice_count > 0)::bigint customers_with_invoices,
      count(*) filter (where least(first_invoice, first_order) between p_from and p_to)::bigint new_customers,
      count(*) filter (where last_commercial_activity is null or last_commercial_activity < p_to - greatest(p_inactivity_days, 1))::bigint inactive_customers,
      coalesce(sum(invoice_count), 0)::bigint invoice_count,
      coalesce(sum(invoice_total), 0)::numeric invoice_total,
      coalesce(sum(order_count), 0)::bigint order_count,
      coalesce(sum(order_total), 0)::numeric order_total
    from customer_metrics
  ), pipeline as (
    select
      count(*) filter (where not coalesce(s.finale, false))::bigint open_opportunities,
      coalesce(sum(o.valore) filter (where not coalesce(s.finale, false)), 0)::numeric pipeline_value,
      coalesce(sum(o.valore * coalesce(o.probabilita, 0) / 100.0) filter (where not coalesce(s.finale, false)), 0)::numeric weighted_pipeline,
      count(*) filter (where not coalesce(s.finale, false) and o.chiusura_prevista < current_date)::bigint overdue_opportunities
    from public.crm_opportunities o
    join public.crm_accounts a on a.id = o.account_id and a.tipo = p_crm_type
    left join public.crm_opportunity_stages s on s.id = o.stage_id
    where public.crm_row_visible(coalesce(o.responsabile_id, a.responsabile_id), coalesce(o.reparto_id, a.reparto_id), public.crm_module_for_type(p_crm_type))
  ), activity as (
    select count(*) filter (where a.stato <> 'completata' and a.data_attivita < now())::bigint overdue_followups
    from public.crm_activities a
    where a.crm_tipo = p_crm_type
      and public.crm_row_visible(a.responsabile_id, a.reparto_id, public.crm_module_for_type(p_crm_type))
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'customers', c.customers,
    'active_customers', c.active_customers,
    'customers_with_activity', c.customers_with_activity,
    'customers_with_orders', c.customers_with_orders,
    'customers_with_invoices', c.customers_with_invoices,
    'new_customers', c.new_customers,
    'inactive_customers', c.inactive_customers,
    'invoice_count', c.invoice_count,
    'invoice_total', c.invoice_total,
    'order_count', c.order_count,
    'order_total', c.order_total,
    'average_order_value', case when c.order_count > 0 then c.order_total / c.order_count else 0 end,
    'open_opportunities', p.open_opportunities,
    'pipeline_value', p.pipeline_value,
    'weighted_pipeline', p.weighted_pipeline,
    'overdue_opportunities', p.overdue_opportunities,
    'overdue_followups', a.overdue_followups,
    'order_source_note', 'Ordini presenti nel Workspace; copertura dipendente dalla sincronizzazione corrente.',
    'invoice_source_note', 'Fatture di vendita Mexal sincronizzate nel Workspace.'
  ) into result
  from customer_totals c cross join pipeline p cross join activity a;

  return coalesce(result, '{}'::jsonb);
end;
$$;

create or replace function public.crm_customer_period_metrics(
  p_customer_code text,
  p_crm_type text,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.crm_customer_classification_visible(p_customer_code, p_crm_type) then
    raise exception 'Cliente non trovato o non autorizzato.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Intervallo CRM non valido.' using errcode = '22023';
  end if;

  with invoices as (
    select count(*)::bigint lifetime_count,
      coalesce(sum(totale_documento), 0)::numeric lifetime_total,
      count(*) filter (where data_documento between p_from and p_to)::bigint period_count,
      coalesce(sum(totale_documento) filter (where data_documento between p_from and p_to), 0)::numeric period_total,
      max(data_documento) last_date
    from public.mexal_fatture_vendita where codice_cliente = p_customer_code
  ), orders as (
    select count(*)::bigint lifetime_count,
      coalesce(sum(totale_documento), 0)::numeric lifetime_total,
      count(*) filter (where data_ordine between p_from and p_to)::bigint period_count,
      coalesce(sum(totale_documento) filter (where data_ordine between p_from and p_to), 0)::numeric period_total,
      max(data_ordine) last_date
    from public.ordini_testate where codice_cliente = p_customer_code
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'invoice_lifetime_count', i.lifetime_count,
    'invoice_lifetime_total', i.lifetime_total,
    'invoice_period_count', i.period_count,
    'invoice_period_total', i.period_total,
    'last_invoice_date', i.last_date,
    'order_lifetime_count', o.lifetime_count,
    'order_lifetime_total', o.lifetime_total,
    'order_period_count', o.period_count,
    'order_period_total', o.period_total,
    'last_order_date', o.last_date,
    'average_order_value', case when o.period_count > 0 then o.period_total / o.period_count else 0 end
  ) into result from invoices i cross join orders o;
  return result;
end;
$$;

create or replace function public.crm_customer_metric_details(
  p_crm_type text,
  p_from date,
  p_to date,
  p_metric text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  codice_cliente text,
  ragione_sociale text,
  agente_classificazione text,
  origine_classificazione text,
  modalita text,
  attivo_mexal boolean,
  crm_account_id uuid,
  stato_crm text,
  ultima_attivita_il timestamptz,
  prossima_attivita_il timestamptz,
  opportunita_count bigint,
  invoice_count bigint,
  invoice_total numeric,
  order_count bigint,
  order_total numeric,
  ultimo_ordine_il date,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with customers as (
    select c.codice_cliente, c.ragione_sociale, x.agente_classificazione,
      x.origine_classificazione,
      case when x.area_override is null then 'automatico' else 'manuale' end modalita,
      c.attivo_mexal
    from public.crm_customer_classifications x
    join public.ordini_clienti_cache c using (codice_cliente)
    where x.area_crm = p_crm_type
      and public.crm_customer_classification_visible(x.codice_cliente, x.area_crm)
      and (nullif(btrim(p_search), '') is null
        or c.codice_cliente ilike '%' || btrim(p_search) || '%'
        or c.ragione_sociale ilike '%' || btrim(p_search) || '%'
        or x.agente_classificazione ilike '%' || btrim(p_search) || '%')
  ), measured as (
    select c.*,
      account.id crm_account_id, account.stato stato_crm,
      account.ultima_attivita_il, account.prossima_attivita_il,
      coalesce(opportunities.opportunita_count, 0) opportunita_count,
      coalesce(inv.invoice_count, 0) invoice_count,
      coalesce(inv.invoice_total, 0) invoice_total,
      inv.first_date first_invoice,
      inv.last_date last_invoice,
      coalesce(ord.order_count, 0) order_count,
      coalesce(ord.order_total, 0) order_total,
      ord.first_date first_order,
      ord.last_date ultimo_ordine_il
    from customers c
    left join lateral (
      select a.* from public.crm_accounts a
      where a.tipo = p_crm_type and a.codice_cliente_mexal = c.codice_cliente
        and public.crm_row_visible(a.responsabile_id, a.reparto_id, public.crm_module_for_type(a.tipo))
      order by a.aggiornato_il desc limit 1
    ) account on true
    left join lateral (
      select count(*)::bigint opportunita_count from public.crm_opportunities o
      where o.account_id = account.id
    ) opportunities on true
    left join lateral (
      select
        count(*) filter (where f.data_documento between p_from and p_to)::bigint invoice_count,
        coalesce(sum(f.totale_documento) filter (where f.data_documento between p_from and p_to), 0)::numeric invoice_total,
        min(f.data_documento) first_date, max(f.data_documento) last_date
      from public.mexal_fatture_vendita f where f.codice_cliente = c.codice_cliente
    ) inv on true
    left join lateral (
      select
        count(*) filter (where o.data_ordine between p_from and p_to)::bigint order_count,
        coalesce(sum(o.totale_documento) filter (where o.data_ordine between p_from and p_to), 0)::numeric order_total,
        min(o.data_ordine) first_date, max(o.data_ordine) last_date
      from public.ordini_testate o where o.codice_cliente = c.codice_cliente
    ) ord on true
  ), filtered as (
    select * from measured m
    where coalesce(p_metric, '') in ('', 'all')
      or (p_metric = 'active' and (m.invoice_count > 0 or m.order_count > 0))
      or (p_metric = 'invoiced' and m.invoice_count > 0)
      or (p_metric = 'ordered' and m.order_count > 0)
      or (p_metric = 'new' and least(m.first_invoice, m.first_order) between p_from and p_to)
      or (p_metric = 'inactive' and (greatest(m.last_invoice, m.ultimo_ordine_il) is null or greatest(m.last_invoice, m.ultimo_ordine_il) < p_to - 90))
  )
  select f.codice_cliente, f.ragione_sociale, f.agente_classificazione,
    f.origine_classificazione, f.modalita, f.attivo_mexal, f.crm_account_id,
    f.stato_crm, f.ultima_attivita_il, f.prossima_attivita_il,
    f.opportunita_count, f.invoice_count, f.invoice_total,
    f.order_count, f.order_total, f.ultimo_ordine_il,
    count(*) over()::bigint total_count
  from filtered f
  order by f.ragione_sociale
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.crm_customer_metric_details(text,date,date,text,text,integer,integer) from public, anon;
grant execute on function public.crm_customer_metric_details(text,date,date,text,text,integer,integer) to authenticated, service_role;

revoke all on function public.crm_dashboard_metrics(text,date,date,integer) from public, anon;
grant execute on function public.crm_dashboard_metrics(text,date,date,integer) to authenticated, service_role;
revoke all on function public.crm_customer_period_metrics(text,text,date,date) from public, anon;
grant execute on function public.crm_customer_period_metrics(text,text,date,date) to authenticated, service_role;

-- Storico fase e tempo nello stato, senza riscrivere opportunita esistenti.
create table if not exists public.crm_opportunity_stage_history (
  id bigint generated by default as identity primary key,
  opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade,
  from_stage_id uuid references public.crm_opportunity_stages(id) on delete set null,
  to_stage_id uuid references public.crm_opportunity_stages(id) on delete set null,
  changed_by uuid references public.utenti(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists crm_opportunity_stage_history_opportunity_idx
  on public.crm_opportunity_stage_history(opportunity_id, changed_at desc);
alter table public.crm_opportunity_stage_history enable row level security;
create policy "crm opportunity stage history read"
on public.crm_opportunity_stage_history for select to authenticated
using (exists (
  select 1 from public.crm_opportunities o
  join public.crm_accounts a on a.id = o.account_id
  where o.id = opportunity_id
    and public.crm_row_visible(coalesce(o.responsabile_id, a.responsabile_id), coalesce(o.reparto_id, a.reparto_id), public.crm_module_for_type(a.tipo))
));

revoke all on public.crm_opportunity_stage_history from public, anon;
grant select on public.crm_opportunity_stage_history to authenticated, service_role;

create or replace function public.crm_record_opportunity_stage_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    insert into public.crm_opportunity_stage_history(opportunity_id, from_stage_id, to_stage_id, changed_by)
    values (new.id, case when tg_op = 'INSERT' then null else old.stage_id end, new.stage_id, public.workspace_current_profile_id());
  end if;
  return new;
end;
$$;
revoke all on function public.crm_record_opportunity_stage_change() from public, anon, authenticated;

drop trigger if exists crm_opportunity_stage_history_trigger on public.crm_opportunities;
create trigger crm_opportunity_stage_history_trigger
after insert or update of stage_id on public.crm_opportunities
for each row execute function public.crm_record_opportunity_stage_change();

-- Fasi commerciali specifiche aggiunte senza cancellare dati o cambiare codici in uso.
insert into public.crm_opportunity_stages (crm_tipo, codice, nome, ordine, finale, vinta)
values
  ('b2b','lead','Lead',5,false,false),
  ('b2b','primo_contatto','Primo contatto',10,false,false),
  ('b2b','presentazione','Presentazione',30,false,false),
  ('b2b','attesa_ordine','Attesa ordine',70,false,false),
  ('conto_terzi','lead','Lead',5,false,false),
  ('conto_terzi','valutazione','Valutazione',25,false,false)
on conflict (crm_tipo, codice) do update
set nome = excluded.nome, ordine = excluded.ordine, attiva = true, aggiornato_il = now();

-- Il codice storico resta stabile; per Conto Terzi assume il significato
-- operativo di primo contatto senza spezzare eventuali riferimenti.
update public.crm_opportunity_stages
set nome = 'Primo contatto', ordine = 10, attiva = true, aggiornato_il = now()
where crm_tipo = 'conto_terzi' and codice = 'nuovo_contatto';

-- Disattiva solo fasi B2B non pertinenti e mai referenziate.
update public.crm_opportunity_stages s set attiva = false, aggiornato_il = now()
where s.crm_tipo = 'b2b'
  and s.codice in ('nuovo_contatto','brief','campionatura','approvazione','industrializzazione','cliente_attivo')
  and not exists (select 1 from public.crm_opportunities o where o.stage_id = s.id);

create index if not exists ordini_testate_customer_period_idx
  on public.ordini_testate(codice_cliente, data_ordine desc);
create index if not exists mexal_fatture_customer_period_idx
  on public.mexal_fatture_vendita(codice_cliente, data_documento desc);

comment on function public.crm_dashboard_metrics(text,date,date,integer) is
  'KPI CRM aggregati server-side, distinti per sorgente e filtrati con visibilita Workspace.';
comment on function public.crm_customer_period_metrics(text,text,date,date) is
  'Metriche cliente lifetime e periodo; ordinato Workspace distinto dal fatturato Mexal.';
comment on table public.crm_opportunity_stage_history is
  'Storico immutabile dei passaggi di fase per misurare giorni nello stato.';

commit;

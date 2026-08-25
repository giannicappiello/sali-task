begin;

-- La visibilita dei clienti canonici segue contemporaneamente:
-- area CRM autorizzata e ambito dati Workspace (propri/team/tutti).
create or replace function public.crm_customer_classification_visible(
  target_customer_code text,
  target_area text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select
      u.id,
      u.codice_agente_mexal,
      coalesce(r.amministratore_workspace, false) as is_admin,
      coalesce(r.ambito_dati, 'propri') as data_scope
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
    limit 1
  ), customer as (
    select c.codice_agente_mexal
    from public.ordini_clienti_cache c
    where c.codice_cliente = target_customer_code
  )
  select case
    when auth.role() = 'service_role' then true
    when not exists (select 1 from me) then false
    when (select is_admin from me) then true
    when target_area not in ('conto_terzi', 'b2b', 'online') then false
    when not public.crm_has_module_level(public.crm_module_for_type(target_area), 'lettura') then false
    when (select data_scope from me) = 'tutti' then true
    when nullif(public.normalize_mexal_agent_code((select codice_agente_mexal from customer)), '') is null then false
    when (select data_scope from me) = 'team' then
      public.normalize_mexal_agent_code((select codice_agente_mexal from customer)) in (
        select public.normalize_mexal_agent_code(code)
        from public.visible_mexal_agent_codes() code
      )
    else
      public.normalize_mexal_agent_code((select codice_agente_mexal from customer)) =
      public.normalize_mexal_agent_code((select codice_agente_mexal from me))
  end;
$$;

revoke all on function public.crm_customer_classification_visible(text, text)
  from public, anon;
grant execute on function public.crm_customer_classification_visible(text, text)
  to authenticated, service_role;

drop policy if exists "crm customer classifications admin read"
  on public.crm_customer_classifications;
drop policy if exists "crm customer classifications scoped read"
  on public.crm_customer_classifications;
create policy "crm customer classifications scoped read"
on public.crm_customer_classifications
for select to authenticated
using (
  public.crm_customer_classification_visible(codice_cliente, area_crm)
);

-- La view e eseguita dal proprietario per non concedere SELECT diretto
-- sull'anagrafica Mexal, ma applica sempre il filtro esplicito per il caller.
create or replace view public.crm_classified_customers
with (security_invoker = false, security_barrier = true)
as
select
  cliente.codice_cliente,
  cliente.ragione_sociale,
  cliente.codice_agente_mexal,
  classificazione.agente_classificazione,
  classificazione.area_automatica,
  classificazione.area_override,
  classificazione.area_crm,
  classificazione.origine_classificazione,
  case when classificazione.area_override is null then 'automatico' else 'manuale' end as modalita,
  classificazione.classificata_il,
  classificazione.override_da,
  classificazione.override_il,
  classificazione.override_note,
  cliente.attivo_mexal,
  cliente.ultimo_sync_mexal,
  cliente.partita_iva,
  cliente.codice_fiscale,
  cliente.indirizzo,
  cliente.cap,
  cliente.localita,
  cliente.provincia,
  cliente.telefono,
  cliente.email,
  account.id as crm_account_id,
  account.stato as stato_crm,
  account.stato_relazione,
  account.valore_cliente,
  account.ultima_attivita_il,
  account.prossima_attivita_il,
  coalesce(opportunities.opportunita_count, 0)::bigint as opportunita_count,
  orders.ultimo_ordine_il,
  invoices.fatturato
from public.ordini_clienti_cache cliente
join public.crm_customer_classifications classificazione
  on classificazione.codice_cliente = cliente.codice_cliente
left join lateral (
  select a.*
  from public.crm_accounts a
  where a.tipo = classificazione.area_crm
    and a.codice_cliente_mexal = cliente.codice_cliente
    and public.crm_row_visible(
      a.responsabile_id,
      a.reparto_id,
      public.crm_module_for_type(a.tipo)
    )
  order by a.aggiornato_il desc
  limit 1
) account on true
left join lateral (
  select count(*)::bigint as opportunita_count
  from public.crm_opportunities opportunity
  where opportunity.account_id = account.id
    and public.crm_row_visible(
      coalesce(opportunity.responsabile_id, account.responsabile_id),
      coalesce(opportunity.reparto_id, account.reparto_id),
      public.crm_module_for_type(classificazione.area_crm)
    )
) opportunities on true
left join lateral (
  select max(o.data_ordine) as ultimo_ordine_il
  from public.ordini_testate o
  where o.codice_cliente = cliente.codice_cliente
) orders on true
left join lateral (
  select coalesce(sum(f.totale_documento), 0)::numeric(16, 2) as fatturato
  from public.mexal_fatture_vendita f
  where f.codice_cliente = cliente.codice_cliente
) invoices on true
where public.crm_customer_classification_visible(
  classificazione.codice_cliente,
  classificazione.area_crm
);

revoke all on public.crm_classified_customers from public, anon;
grant select on public.crm_classified_customers to authenticated, service_role;

comment on function public.crm_customer_classification_visible(text, text) is
  'Visibilita cliente canonico per area CRM e ambito Workspace propri/team/tutti.';
comment on view public.crm_classified_customers is
  'Catalogo clienti Workspace/Mexal filtrato per area CRM e scope; crm_accounts resta un layer CRM opzionale.';

commit;

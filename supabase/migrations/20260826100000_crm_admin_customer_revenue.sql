begin;
-- Estende il catalogo amministrativo con il fatturato lifetime già sincronizzato
-- da Mexal. L'aggregazione resta server-side e parte esclusivamente dai clienti
-- già visibili nel catalogo CRM, evitando query N+1 dal frontend.
create or replace view public.crm_customer_admin_catalog
with (security_invoker = false, security_barrier = true)
as
select catalog.*,
  coalesce(revenue.invoice_total_lifetime, 0)::numeric invoice_total_lifetime
from public.crm_customer_classification_catalog catalog
left join (
  select invoice.codice_cliente,
    coalesce(sum(invoice.totale_documento), 0)::numeric invoice_total_lifetime
  from public.mexal_fatture_vendita invoice
  group by invoice.codice_cliente
) revenue using (codice_cliente);
revoke all on public.crm_customer_admin_catalog from public, anon;
grant select on public.crm_customer_admin_catalog to authenticated, service_role;
comment on view public.crm_customer_admin_catalog is
  'Catalogo CRM amministrativo con fatturato lifetime Mexal aggregato server-side per cliente visibile.';
commit;

-- Consente agli utenti autorizzati a CRM BRAND DIRECT di leggere esclusivamente
-- il catalogo necessario ai progetti del cliente virtuale DIRECT.
-- La policy e' additiva e non modifica dati o associazioni esistenti.

drop policy if exists "crm brand direct read product catalog"
  on public.prodotti;

create policy "crm brand direct read product catalog"
on public.prodotti
for select
to authenticated
using (
  public.crm_has_module_level('crm_brand_direct', 'lettura')
  and coalesce(attivo_mexal, true)
  and coalesce(mostra_in_app, true)
  and (
    upper(coalesce(codice_mexal, codice, '')) like 'IT%'
    or upper(coalesce(codice_mexal, codice, '')) like 'MKT%'
  )
);

drop policy if exists "crm brand direct read implant catalog"
  on public.ordini_impianti;

create policy "crm brand direct read implant catalog"
on public.ordini_impianti
for select
to authenticated
using (
  public.crm_has_module_level('crm_brand_direct', 'lettura')
  and attivo is true
  and upper(coalesce(codice, '')) like 'IMP%'
);

-- Il cliente virtuale DIRECT non ha responsabile o reparto: la policy CRM
-- generica lo nasconde agli utenti con ambito dati propri/team. Consenti la
-- lettura del solo record virtuale a chi puo' leggere CRM BRAND DIRECT.

begin;

drop policy if exists "crm accounts scoped read" on public.crm_accounts;
create policy "crm accounts scoped read"
on public.crm_accounts
for select
to authenticated
using (
  (
    id = '00000000-0000-4000-8000-000000000001'::uuid
    and tipo = 'brand_direct'
    and public.crm_has_module_level('crm_brand_direct', 'lettura')
  )
  or public.crm_row_visible(
    responsabile_id,
    reparto_id,
    public.crm_module_for_type(tipo)
  )
);

commit;

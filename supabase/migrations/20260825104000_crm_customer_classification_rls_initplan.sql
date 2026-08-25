begin;

drop policy if exists "crm customer classifications scoped read"
  on public.crm_customer_classifications;
create policy "crm customer classifications scoped read"
on public.crm_customer_classifications
for select to authenticated
using (
  area_crm::text = any (
    ((select public.crm_visible_customer_areas()))::text[]
  )
  and codice_cliente::text = any (
    (
      select coalesce(array_agg(visible.customer_code), '{}'::text[])
      from public.crm_visible_canonical_customer_codes() visible(customer_code)
    )::text[]
  )
);

comment on policy "crm customer classifications scoped read"
on public.crm_customer_classifications is
  'RLS area e scope con InitPlan non correlati, calcolati una sola volta per statement.';

commit;

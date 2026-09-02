begin;

create or replace function public.workspace_can_manage_direct_product_implants()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with access_context as (
    select public.workspace_access_context() as value
  )
  select coalesce(
    (value -> 'modules') ? 'prodotti'
    and (value -> 'module_levels' ->> 'prodotti') = 'amministrazione',
    false
  )
  from access_context
$$;

revoke all on function public.workspace_can_manage_direct_product_implants() from public, anon;
grant execute on function public.workspace_can_manage_direct_product_implants() to authenticated, service_role;

drop policy if exists "admins manage order kits" on public.ordini_impianti;
drop policy if exists "direct product managers manage order kits" on public.ordini_impianti;
create policy "direct product managers manage order kits"
  on public.ordini_impianti for all to authenticated
  using (public.workspace_can_manage_direct_product_implants())
  with check (public.workspace_can_manage_direct_product_implants());

drop policy if exists "admins manage order kit components" on public.ordini_impianti_componenti;
drop policy if exists "direct product managers manage order kit components" on public.ordini_impianti_componenti;
create policy "direct product managers manage order kit components"
  on public.ordini_impianti_componenti for all to authenticated
  using (public.workspace_can_manage_direct_product_implants())
  with check (public.workspace_can_manage_direct_product_implants());

commit;

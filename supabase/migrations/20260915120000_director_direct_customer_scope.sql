begin;

-- Role identities, not personal exceptions or agent logins. PRIVATE and
-- operational department/hierarchy membership deliberately remain unchanged.
create table public.workspace_direct_customer_roles (
  role_id uuid primary key references public.ruoli(id) on delete cascade
);
alter table public.workspace_direct_customer_roles enable row level security;
revoke all on public.workspace_direct_customer_roles from public, anon, authenticated;
grant all on public.workspace_direct_customer_roles to service_role;
insert into public.workspace_direct_customer_roles(role_id)
select id from public.ruoli where lower(btrim(nome)) = 'direzione';

create or replace function public.workspace_direct_customer_reader()
returns boolean language sql stable security definer set search_path=public
as $$
  select exists (
    select 1 from public.utenti u
    join public.workspace_direct_customer_roles r on r.role_id=u.ruolo_id
    where u.auth_user_id=auth.uid() and u.attivo is not false
      and not exists(select 1 from public.workspace_customer_user_links l where l.user_id=u.id)
  );
$$;

create or replace function public.workspace_direct_customer_codes()
returns setof text language sql stable security definer set search_path=public
as $$
  select c.codice_cliente from public.ordini_clienti_cache c
  where (select public.workspace_direct_customer_reader()) and c.sync_excluded is false
    and public.crm_customer_effective_area(c.cod_alternativo,c.nome_ricerca_cf,c.crm_restored_area) in ('b2b','online');
$$;

-- Add a separate capability to the session. Never promote mode/commercial_mode
-- to tutti: that would also expose PRIVATE and unrelated operational records.
do $migration$
declare original text; changed text;
begin
  original:=pg_get_functiondef('public.workspace_data_scope()'::regprocedure);
  changed:=replace(original, '''private_commercial_read'', public.workspace_private_commercial_reader(),',
    '''direct_customer_read'', public.workspace_direct_customer_reader(),
    ''private_commercial_read'', public.workspace_private_commercial_reader(),');
  if changed=original then raise exception 'Unexpected workspace data scope definition'; end if;
  execute changed;
end $migration$;

create or replace function public.crm_visible_canonical_customer_codes()
returns setof text language sql stable security definer set search_path=public
as $$
  with scope as materialized(select public.workspace_data_scope() as data),
  agents as materialized(select public.normalize_mexal_agent_code(code) code from public.visible_mexal_agent_codes() code),
  private_codes as materialized(select public.workspace_private_customer_codes() code),
  direct_codes as materialized(select public.workspace_direct_customer_codes() code)
  select c.codice_cliente from public.ordini_clienti_cache c cross join scope s
  where c.sync_excluded is false and (
    auth.role()='service_role'
    or (s.data->>'customer_code' is not null and public.workspace_customer_data_visible(c.codice_cliente))
    or (s.data->>'customer_code' is null and (
      s.data->>'commercial_mode'='tutti'
      or c.codice_cliente in (select code from private_codes)
      or c.codice_cliente in (select code from direct_codes)
      or nullif(public.normalize_mexal_agent_code(coalesce(nullif(c.codice_agente_mexal,''),
        public.mexal_client_agent_code(c.json_mexal),public.mexal_client_agent_code(c.dati_mexal))),'')
        in (select code from agents)
    ))
  );
$$;

alter policy "department scope customer directory" on public.ordini_clienti_cache using (
  (select public.workspace_commercial_read_all())
  or codice_cliente in(select public.workspace_private_customer_codes())
  or codice_cliente in(select public.workspace_direct_customer_codes())
  or (select public.workspace_data_scope()->>'mode')<>'team'
  or public.normalize_mexal_agent_code(coalesce(nullif(codice_agente_mexal,''),
    public.mexal_client_agent_code(json_mexal),public.mexal_client_agent_code(dati_mexal)))
    in(select public.workspace_operational_agent_codes())
);
alter policy "department scope customer orders" on public.ordini_testate using (
  (select public.workspace_commercial_read_all())
  or codice_cliente in(select public.workspace_private_customer_codes())
  or (modulo_ordini in ('prof','ph') and codice_cliente in(select public.workspace_direct_customer_codes()))
  or (select public.workspace_data_scope()->>'mode')<>'team'
  or public.normalize_mexal_agent_code(codice_agente_mexal) in(select public.workspace_operational_agent_codes())
);
create policy "directors read direct customer invoices" on public.mexal_fatture_vendita
for select to authenticated using (codice_cliente in(select public.workspace_direct_customer_codes()));
-- Existing invoice/order line SELECT policies inherit the visible parent.

-- A newly selectable customer must also be usable in a PR/PH draft. Keep the
-- existing module write permission; this does not grant modules or admin rights.
create or replace function public.workspace_direct_order_customer_writable(customer_code text, order_module text)
returns boolean language sql stable security definer set search_path=public
as $$
  select coalesce(order_module in ('prof','ph')
    and public.crm_has_module_level(case order_module when 'prof' then 'ordini_pr' when 'ph' then 'ordini_ph' end,'scrittura')
    and customer_code in(select public.workspace_direct_customer_codes()),false);
$$;
alter policy "department scope customer orders insert" on public.ordini_testate
with check (public.workspace_team_agent_visible(codice_agente_mexal)
  or public.workspace_direct_order_customer_writable(codice_cliente,modulo_ordini));
alter policy "department scope customer orders update" on public.ordini_testate
using (public.workspace_team_agent_visible(codice_agente_mexal)
  or public.workspace_direct_order_customer_writable(codice_cliente,modulo_ordini))
with check (public.workspace_team_agent_visible(codice_agente_mexal)
  or public.workspace_direct_order_customer_writable(codice_cliente,modulo_ordini));
alter policy "department scope order lines insert" on public.ordini_righe
with check ((select public.workspace_data_scope()->>'mode')<>'team' or exists (
  select 1 from public.ordini_testate h where h.id=ordine_id and
    (public.workspace_team_agent_visible(h.codice_agente_mexal)
      or public.workspace_direct_order_customer_writable(h.codice_cliente,h.modulo_ordini))
));
alter policy "department scope order lines update" on public.ordini_righe
using ((select public.workspace_data_scope()->>'mode')<>'team' or exists (
  select 1 from public.ordini_testate h where h.id=ordine_id and
    (public.workspace_team_agent_visible(h.codice_agente_mexal)
      or public.workspace_direct_order_customer_writable(h.codice_cliente,h.modulo_ordini))
))
with check ((select public.workspace_data_scope()->>'mode')<>'team' or exists (
  select 1 from public.ordini_testate h where h.id=ordine_id and
    (public.workspace_team_agent_visible(h.codice_agente_mexal)
      or public.workspace_direct_order_customer_writable(h.codice_cliente,h.modulo_ordini))
));
-- Saving an edited draft replaces its lines, so allow that same authorized scope.
alter policy "department scope order lines delete" on public.ordini_righe
using ((select public.workspace_data_scope()->>'mode')<>'team' or exists (
  select 1 from public.ordini_testate h where h.id=ordine_id and
    (public.workspace_team_agent_visible(h.codice_agente_mexal)
      or (h.stato='bozza' and public.workspace_direct_order_customer_writable(h.codice_cliente,h.modulo_ordini)))
));

revoke all on function public.workspace_direct_customer_reader(), public.workspace_direct_customer_codes(),
  public.workspace_direct_order_customer_writable(text,text) from public,anon;
grant execute on function public.workspace_direct_customer_reader(), public.workspace_direct_customer_codes(),
  public.workspace_direct_order_customer_writable(text,text) to authenticated,service_role;
create trigger workspace_direct_customer_roles_changed
after insert or update or delete on public.workspace_direct_customer_roles
for each statement execute function public.workspace_touch_access_revision();
update public.workspace_access_revision set revision=revision+1 where id;
notify pgrst,'reload schema';
commit;

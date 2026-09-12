begin;

-- Stable role/department identities survive renaming. This is a data-reading
-- rule, not a module/screen grant, nor an operational administrator role.
create table public.workspace_commercial_read_rules (
  role_id uuid not null references public.ruoli(id) on delete cascade,
  department_id uuid not null references public.reparti(id) on delete cascade,
  primary key (role_id, department_id)
);
alter table public.workspace_commercial_read_rules enable row level security;
revoke all on public.workspace_commercial_read_rules from public, anon, authenticated;
grant all on public.workspace_commercial_read_rules to service_role;
insert into public.workspace_commercial_read_rules(role_id, department_id)
select r.id,d.id from public.ruoli r cross join public.reparti d
where lower(btrim(r.nome))='direzione'
  and lower(btrim(d.nome)) in ('marketing','comunicazione');

create or replace function public.workspace_commercial_read_all()
returns boolean language sql stable security definer set search_path=public
as $$
  select exists (
    select 1 from public.utenti u
    join public.workspace_commercial_read_rules rule on rule.role_id=u.ruolo_id
    join public.utenti_reparti ur on ur.utente_id=u.id and ur.reparto_id=rule.department_id
    join public.reparti d on d.id=ur.reparto_id and d.attivo is not false
    where u.auth_user_id=auth.uid() and u.attivo is not false
      and not exists (select 1 from public.workspace_customer_user_links l where l.user_id=u.id)
  );
$$;
revoke all on function public.workspace_commercial_read_all() from public,anon;
grant execute on function public.workspace_commercial_read_all() to authenticated,service_role;

-- Extend the session envelope without changing operational mode, users,
-- departments or agents. BeautyDays and task scope continue using these fields.
do $migration$
declare original text; changed text;
begin
  original:=pg_get_functiondef('public.workspace_data_scope()'::regprocedure);
  changed:=replace(original,
    '''mode'', coalesce((select mode from effective_scope), ''propri'')',
    '''commercial_mode'', case when public.workspace_commercial_read_all() then ''tutti'' else coalesce((select mode from effective_scope), ''propri'') end,
    ''mode'', coalesce((select mode from effective_scope), ''propri'')');
  if changed=original then raise exception 'Unexpected operational scope definition'; end if;
  execute changed;

  original:=pg_get_functiondef('public.visible_mexal_clients_for_me()'::regprocedure);
  changed:=replace(original, 'coalesce(me.ambito_dati, ''propri'') = ''tutti''',
    '(coalesce(me.ambito_dati, ''propri'') = ''tutti'' or (select public.workspace_commercial_read_all()))');
  if changed=original then raise exception 'Unexpected customer scope definition'; end if;
  execute changed;

  original:=pg_get_functiondef('public.crm_visible_canonical_customer_codes()'::regprocedure);
  changed:=replace(original, 'me.data_scope = ''tutti''',
    '(me.data_scope = ''tutti'' or (select public.workspace_commercial_read_all()))');
  if changed=original then raise exception 'Unexpected canonical CRM scope definition'; end if;
  execute changed;
end $migration$;

create or replace function public.visible_mexal_agent_ids()
returns setof uuid language sql stable security definer set search_path=public
as $$
  with scope as materialized (select public.workspace_data_scope() as data)
  select a.id from public.mexal_agenti a cross join scope
  where (data->>'commercial_mode'='tutti' and a.attivo_mexal is not false)
     or data->'agent_ids' ? a.id::text;
$$;

-- Write restrictions continue to use operational agents, never the commercial set.
create or replace function public.workspace_team_agent_visible(agent_code text)
returns boolean language sql stable security definer set search_path=public
as $$
  with scope as materialized (select public.workspace_data_scope() as data)
  select data->>'mode'<>'team' or exists (
    select 1 from public.mexal_agenti a
    where data->'agent_ids' ? a.id::text
      and nullif(public.normalize_mexal_agent_code(agent_code),'')=public.normalize_mexal_agent_code(a.codice)
  ) from scope;
$$;

create or replace function public.can_view_mexal_sales_invoice(p_agent_code text)
returns boolean language sql stable security definer set search_path=public
as $$
  select public.workspace_data_scope()->>'commercial_mode'='tutti'
    or nullif(public.normalize_mexal_agent_code(p_agent_code),'') in (
      select public.normalize_mexal_agent_code(code) from public.visible_mexal_agent_codes() code
    );
$$;

-- Split restrictive ALL policies: broad commercial SELECT must not broaden
-- INSERT/UPDATE/DELETE. Other permissive and restrictive policies remain intact.
do $policies$
declare spec record; operation text;
begin
 for spec in select * from (values
   ('ordini_testate','department scope customer orders','codice_agente_mexal'),
   ('mexal_agenti','department scope agents','codice')
 ) as t(table_name,policy_name,agent_column) loop
   execute format('drop policy %I on public.%I',spec.policy_name,spec.table_name);
   execute format('create policy %I on public.%I as restrictive for select to authenticated using ((select public.workspace_commercial_read_all()) or public.workspace_team_agent_visible(%I))',
      spec.policy_name,spec.table_name,spec.agent_column);
   foreach operation in array array['insert','update','delete'] loop
     execute format('create policy %I on public.%I as restrictive for %s to authenticated %s %s',
       spec.policy_name || ' ' || operation,spec.table_name,operation,
       case when operation<>'insert' then format('using (public.workspace_team_agent_visible(%I))',spec.agent_column) else '' end,
       case when operation<>'delete' then format('with check (public.workspace_team_agent_visible(%I))',spec.agent_column) else '' end);
   end loop;
 end loop;
end $policies$;

drop policy "department scope customer directory" on public.ordini_clienti_cache;
create policy "department scope customer directory" on public.ordini_clienti_cache
as restrictive for select to authenticated
using ((select public.workspace_commercial_read_all()) or public.workspace_team_agent_visible(coalesce(
 nullif(codice_agente_mexal,''),public.mexal_client_agent_code(json_mexal),public.mexal_client_agent_code(dati_mexal)
)));

drop policy "department scope customer order lines" on public.ordini_righe;
create policy "department scope customer order lines" on public.ordini_righe
as restrictive for select to authenticated
using ((select public.workspace_data_scope())->>'mode'<>'team'
  or exists(select 1 from public.ordini_testate h where h.id=ordine_id));
do $policies$
declare operation text;
begin
 foreach operation in array array['insert','update','delete'] loop
  execute format('create policy %I on public.ordini_righe as restrictive for %s to authenticated %s %s',
    'department scope order lines ' || operation,operation,
    case when operation<>'insert' then 'using ((select public.workspace_data_scope())->>''mode''<>''team'' or exists (select 1 from public.ordini_testate h where h.id=ordine_id and public.workspace_team_agent_visible(h.codice_agente_mexal)))' else '' end,
    case when operation<>'delete' then 'with check ((select public.workspace_data_scope())->>''mode''<>''team'' or exists (select 1 from public.ordini_testate h where h.id=ordine_id and public.workspace_team_agent_visible(h.codice_agente_mexal)))' else '' end);
 end loop;
end $policies$;

create trigger workspace_commercial_read_rules_changed
after insert or update or delete on public.workspace_commercial_read_rules
for each statement execute function public.workspace_touch_access_revision();
update public.workspace_access_revision set revision=revision+1 where id;
notify pgrst, 'reload schema';
commit;

begin;

-- Preserve existing links; each selected customer is an independent membership.
alter table public.workspace_customer_user_links drop constraint workspace_customer_user_links_pkey;
alter table public.workspace_customer_user_links add primary key (user_id, customer_code);

create or replace function public.workspace_current_customer_codes()
returns text[] language sql stable security definer set search_path=public
as $$
  select coalesce(array_agg(l.customer_code order by l.customer_code), '{}'::text[])
  from public.utenti u join public.workspace_customer_user_links l on l.user_id=u.id
  where u.auth_user_id=auth.uid() and u.attivo is not false;
$$;

-- Compatibility marker for existing callers. Never use this scalar for membership.
create or replace function public.workspace_current_customer_code()
returns text language sql stable security definer set search_path=public
as $$ select (public.workspace_current_customer_codes())[1]; $$;

create or replace function public.workspace_customer_data_visible(target_customer_code text)
returns boolean language sql stable security definer set search_path=public
as $$
  select auth.role()='service_role' or (
    exists(select 1 from public.utenti where auth_user_id=auth.uid() and attivo is not false) and (
      cardinality(public.workspace_current_customer_codes())=0
      or upper(btrim(target_customer_code)) in (
        select upper(btrim(code)) from unnest(public.workspace_current_customer_codes()) code
      )
    )
  );
$$;

create or replace function public.workspace_replace_user_customers(
  target_user_id uuid, customer_codes text[], target_role_id uuid default null, actor_id uuid default null
) returns void language plpgsql security definer set search_path=public
as $$
declare selected_codes text[]; resolved_codes text[];
begin
  if coalesce(auth.role(),'') <> 'service_role' and not coalesce(public.workspace_user_is_admin(),false) then
    raise exception 'Operazione riservata all’amministratore.' using errcode='42501';
  end if;
  -- Serialize concurrent edits and replace the entire set atomically.
  perform 1 from public.utenti where id=target_user_id for update;
  if not found then raise exception 'Utente non trovato.'; end if;
  select coalesce(array_agg(distinct upper(btrim(code))), '{}'::text[]) into selected_codes
  from unnest(coalesce(customer_codes,'{}'::text[])) code where nullif(btrim(code),'') is not null;
  if cardinality(selected_codes)=0 and exists (
    select 1 from public.ruoli where id=coalesce(target_role_id,(select ruolo_id from public.utenti where id=target_user_id))
      and nome ~* '(^|\s)(cliente|customer)(\s|$)'
  ) then raise exception 'Per un utente Cliente seleziona almeno un cliente.'; end if;
  select coalesce(array_agg(c.codice_cliente order by c.codice_cliente), '{}'::text[]) into resolved_codes
  from public.ordini_clienti_cache c where upper(btrim(c.codice_cliente))=any(selected_codes)
    and (c.attivo_mexal is not false or exists (
      select 1 from public.workspace_customer_user_links l where l.user_id=target_user_id and l.customer_code=c.codice_cliente
    ));
  if cardinality(resolved_codes) <> cardinality(selected_codes) then
    raise exception 'Uno o più clienti non esistono o non sono attivi nell’anagrafica Workspace/Mexal.';
  end if;
  delete from public.workspace_customer_user_links l
    where l.user_id=target_user_id and not(l.customer_code=any(resolved_codes));
  insert into public.workspace_customer_user_links(user_id,customer_code,linked_by)
    select target_user_id,code,case when auth.role()='service_role' then actor_id else public.workspace_current_profile_id() end
    from unnest(resolved_codes) code on conflict(user_id,customer_code) do nothing;
end;
$$;

-- This is a READ scope, not a module grant or a write scope.
create table public.workspace_private_commercial_read_rules(
  role_id uuid not null references public.ruoli(id) on delete cascade,
  department_id uuid not null references public.reparti(id) on delete cascade,
  primary key(role_id,department_id)
);
alter table public.workspace_private_commercial_read_rules enable row level security;
revoke all on public.workspace_private_commercial_read_rules from public,anon,authenticated;
grant all on public.workspace_private_commercial_read_rules to service_role;
insert into public.workspace_private_commercial_read_rules(role_id,department_id)
select r.id,d.id from public.ruoli r cross join public.reparti d
where lower(btrim(r.nome))='direzione' and lower(btrim(d.nome))='produzione';

create or replace function public.workspace_private_commercial_reader()
returns boolean language sql stable security definer set search_path=public
as $$
  select exists (
    select 1 from public.utenti u
    join public.workspace_private_commercial_read_rules rule on rule.role_id=u.ruolo_id
    join public.utenti_reparti ur on ur.utente_id=u.id and ur.reparto_id=rule.department_id
    join public.reparti d on d.id=ur.reparto_id and d.attivo is not false
    where u.auth_user_id=auth.uid() and u.attivo is not false
      and not exists(select 1 from public.workspace_customer_user_links l where l.user_id=u.id)
  );
$$;

create or replace function public.workspace_private_customer_codes()
returns setof text language sql stable security definer set search_path=public
as $$
  select c.codice_cliente from public.crm_customer_classifications c
  join public.ordini_clienti_cache customer on customer.codice_cliente=c.codice_cliente
  where (select public.workspace_private_commercial_reader())
    and c.area_crm='conto_terzi' and customer.sync_excluded is false;
$$;

CREATE OR REPLACE FUNCTION public.workspace_data_scope()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with recursive me as materialized (
    select u.id, coalesce(r.amministratore_workspace, false) as admin,
      coalesce(r.ambito_dati, 'propri') as data_scope,
      coalesce(r.ambito_team, 'associazioni') as team_scope, (public.workspace_current_customer_codes())[1] as customer_code
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid() and u.attivo is not false limit 1
  ), effective_scope as (
    select id, customer_code, team_scope,
      case when customer_code is not null then 'cliente'
        when admin or data_scope = 'tutti' then 'tutti' else data_scope end as mode
    from me
  ), departments as materialized (
    select d.id from public.reparti d cross join effective_scope s
    where d.attivo is not false and (s.mode = 'tutti'
      or (s.mode = 'team' and s.team_scope = 'reparti' and exists (
        select 1 from public.utenti_reparti ur where ur.utente_id = s.id and ur.reparto_id = d.id
      )))
  ), management_edges as materialized (
    select u.responsabile_utente_id as parent_id, u.id as child_id
    from public.utenti u where u.attivo is not false and u.responsabile_utente_id is not null
    union
    select a.responsabile_utente_id, u.id from public.mexal_agenti a
    join public.utenti u on u.id = a.workspace_utente_id or u.mexal_agente_id = a.id
    where a.attivo_mexal is not false and u.attivo is not false
      and a.responsabile_utente_id is not null
  ), base_members(id) as (
    select u.id from public.utenti u cross join effective_scope s
    where u.attivo is not false and (u.id = s.id or s.mode = 'tutti'
      or (s.mode = 'team' and s.team_scope = 'reparti' and exists (
        select 1 from public.utenti_reparti ur where ur.utente_id = u.id
          and ur.reparto_id in (select id from departments)
      )))
    union -- UNION (not ALL) also terminates malformed/cyclic hierarchies.
    select edge.child_id from base_members parent
    join management_edges edge on edge.parent_id = parent.id
    cross join effective_scope s where s.mode = 'team' and s.team_scope = 'gerarchia'
  ), agents as materialized (
    select a.id from public.mexal_agenti a cross join effective_scope s
    where a.attivo_mexal is not false and s.customer_code is null and (
      s.mode = 'tutti' or a.workspace_utente_id in (select id from base_members)
      or a.id in (select u.mexal_agente_id from public.utenti u where u.id in (select id from base_members))
      or exists (select 1 from public.integrazioni_utenti i
        where i.utente_id in (select id from base_members) and i.enabled is true and i.mexal_agente_id = a.id)
      or (s.mode = 'team' and s.team_scope = 'gerarchia'
        and a.responsabile_utente_id in (select id from base_members))
      or (s.mode = 'team' and s.team_scope = 'reparti' and a.responsabile_utente_id = s.id)
    )
  ), members as materialized (
    select id from base_members
    union
    -- An explicitly linked agent contributes their CRM records, but their own
    -- associations do not recursively grant unrelated agents or managers.
    select u.id from public.utenti u cross join effective_scope s
    where s.mode = 'team' and u.attivo is not false and exists (
      select 1 from public.mexal_agenti a where a.id in (select id from agents)
        and (a.workspace_utente_id = u.id or u.mexal_agente_id = a.id)
    )
  )
  select jsonb_build_object(
    'private_commercial_read', public.workspace_private_commercial_reader(),
    'commercial_mode', case when public.workspace_commercial_read_all() then 'tutti'
      else coalesce((select mode from effective_scope), 'propri') end,
    'mode', coalesce((select mode from effective_scope), 'propri'),
    'team_scope', (select team_scope from effective_scope),
    'user_ids', coalesce((select jsonb_agg(id order by id) from members), '[]'::jsonb),
    'department_ids', coalesce((select jsonb_agg(id order by id) from departments), '[]'::jsonb),
    'agent_ids', coalesce((select jsonb_agg(id order by id) from agents), '[]'::jsonb),
    'customer_code', (select customer_code from effective_scope),
    'customer_codes', to_jsonb(public.workspace_current_customer_codes())
  );
$function$;


create or replace function public.crm_visible_canonical_customer_codes()
returns setof text language sql stable security definer set search_path=public
as $$
  with scope as materialized(select public.workspace_data_scope() as data),
  agents as materialized(select public.normalize_mexal_agent_code(code) code from public.visible_mexal_agent_codes() code),
  private_codes as materialized(select public.workspace_private_customer_codes() code)
  select c.codice_cliente from public.ordini_clienti_cache c cross join scope s
  where c.sync_excluded is false and (
    auth.role()='service_role'
    or (s.data->>'customer_code' is not null and public.workspace_customer_data_visible(c.codice_cliente))
    or (s.data->>'customer_code' is null and (
      s.data->>'commercial_mode'='tutti'
      or c.codice_cliente in (select code from private_codes)
      or nullif(public.normalize_mexal_agent_code(coalesce(nullif(c.codice_agente_mexal,''),
        public.mexal_client_agent_code(c.json_mexal),public.mexal_client_agent_code(c.dati_mexal))),'')
        in (select code from agents)
    ))
  );
$$;

create or replace function public.visible_mexal_clients_for_me()
returns setof public.ordini_clienti_cache language sql stable security definer set search_path=public
as $$
  select c.* from public.ordini_clienti_cache c
  where c.attivo_mexal is true and c.codice_cliente in (select public.crm_visible_canonical_customer_codes());
$$;

alter policy "department scope customer directory" on public.ordini_clienti_cache
using ((select public.workspace_commercial_read_all())
  or codice_cliente in (select public.workspace_private_customer_codes())
  or public.workspace_team_agent_visible(coalesce(nullif(codice_agente_mexal,''),
     public.mexal_client_agent_code(json_mexal),public.mexal_client_agent_code(dati_mexal))));
alter policy "department scope customer orders" on public.ordini_testate
using ((select public.workspace_commercial_read_all())
  or codice_cliente in (select public.workspace_private_customer_codes())
  or public.workspace_team_agent_visible(codice_agente_mexal));

-- Invoice lines already inherit visibility from their parent invoice.
create policy "production directors read private invoices" on public.mexal_fatture_vendita
for select to authenticated using (codice_cliente in (select public.workspace_private_customer_codes()));

create policy "production directors read private invoice lines" on public.mexal_fatture_vendita_righe
for select to authenticated using (exists(select 1 from public.mexal_fatture_vendita i
  where i.id=fattura_id and i.codice_cliente in (select public.workspace_private_customer_codes())));

create trigger workspace_private_commercial_rules_changed
after insert or update or delete on public.workspace_private_commercial_read_rules
for each statement execute function public.workspace_touch_access_revision();

revoke all on function public.workspace_current_customer_codes(),public.workspace_private_commercial_reader(),
 public.workspace_private_customer_codes(),public.workspace_replace_user_customers(uuid,text[],uuid,uuid) from public,anon;
grant execute on function public.workspace_current_customer_codes(),public.workspace_private_commercial_reader(),
 public.workspace_private_customer_codes(),public.workspace_replace_user_customers(uuid,text[],uuid,uuid) to authenticated,service_role;

-- Warehouse keeps a single scope marker, but reads articles for every linked customer.
do $$
declare original text; updated text;
begin
  original:=pg_get_functiondef('public.workspace_warehouse_dashboard(date,integer,text,text,text,text,integer,integer)'::regprocedure);
  updated:=replace(original,'upper(btrim(header.codice_cliente)) = upper(btrim(scope.customer_code))',
    'public.workspace_customer_data_visible(header.codice_cliente)');
  updated:=replace(updated,'upper(btrim(invoice.codice_cliente)) = upper(btrim(scope.customer_code))',
    'public.workspace_customer_data_visible(invoice.codice_cliente)');
  if updated=original then raise exception 'Warehouse customer scope contract changed'; end if;
  execute updated;
end $$;

create or replace function public.workspace_operational_agent_codes()
returns setof text language sql stable security definer set search_path=public
as $$
  select public.normalize_mexal_agent_code(a.codice) from public.mexal_agenti a
  where a.id in(select value::uuid from jsonb_array_elements_text(public.workspace_data_scope()->'agent_ids'));
$$;
revoke all on function public.workspace_operational_agent_codes() from public,anon;
grant execute on function public.workspace_operational_agent_codes() to authenticated,service_role;

-- Evaluate the scope once per statement, not once for every catalog/document row.
alter policy "department scope customer directory" on public.ordini_clienti_cache using (
  (select public.workspace_commercial_read_all())
  or codice_cliente in(select public.workspace_private_customer_codes())
  or (select public.workspace_data_scope()->>'mode')<>'team'
  or public.normalize_mexal_agent_code(coalesce(nullif(codice_agente_mexal,''),
    public.mexal_client_agent_code(json_mexal),public.mexal_client_agent_code(dati_mexal)))
    in(select public.workspace_operational_agent_codes())
);
alter policy "department scope customer orders" on public.ordini_testate using (
  (select public.workspace_commercial_read_all())
  or codice_cliente in(select public.workspace_private_customer_codes())
  or (select public.workspace_data_scope()->>'mode')<>'team'
  or public.normalize_mexal_agent_code(codice_agente_mexal) in(select public.workspace_operational_agent_codes())
);
alter policy "linked customer restricts customer catalog" on public.ordini_clienti_cache using (
  (select public.workspace_current_customer_code()) is null
  or codice_cliente=any((select public.workspace_current_customer_codes())::text[])
);
alter policy "linked customer restricts customer orders" on public.ordini_testate using (
  (select public.workspace_current_customer_code()) is null
  or codice_cliente=any((select public.workspace_current_customer_codes())::text[])
);
alter policy "fatture vendita visibili per organizzazione" on public.mexal_fatture_vendita using (
  case when (select public.workspace_current_customer_code()) is not null
    then codice_cliente=any((select public.workspace_current_customer_codes())::text[])
    else (select public.workspace_data_scope()->>'commercial_mode')='tutti'
      or public.normalize_mexal_agent_code(codice_agente_mexal) in(select public.visible_mexal_agent_codes())
  end
);
alter policy "righe fatture vendita visibili per organizzazione" on public.mexal_fatture_vendita_righe
using (exists(select 1 from public.mexal_fatture_vendita i where i.id=fattura_id));

update public.workspace_access_revision set revision=revision+1 where id;
notify pgrst,'reload schema';
commit;

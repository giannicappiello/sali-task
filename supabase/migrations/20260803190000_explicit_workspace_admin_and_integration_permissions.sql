begin;

alter table public.ruoli
  add column if not exists amministratore_workspace boolean not null default false;

update public.ruoli
set amministratore_workspace = true
where coalesce(livello, 0) >= 80
   or lower(btrim(coalesce(nome, ''))) in
      ('admin', 'administrator', 'amministratore', 'super admin', 'direzione');

comment on column public.ruoli.amministratore_workspace is
  'Concede esplicitamente l''accesso amministrativo completo al Workspace.';

insert into public.permessi (codice, descrizione, modulo)
values
  ('integrations.read', 'Accede al Centro Integrazioni', 'integrazioni'),
  ('integrations.configure', 'Gestisce configurazioni e automazioni delle integrazioni', 'integrazioni'),
  ('integrations.sync.clients', 'Sincronizza clienti', 'integrazioni'),
  ('integrations.sync.agents', 'Sincronizza agenti', 'integrazioni'),
  ('integrations.sync.products', 'Sincronizza prodotti', 'integrazioni'),
  ('integrations.sync.product_categories', 'Sincronizza categorie prodotto', 'integrazioni'),
  ('integrations.sync.commercial_conditions', 'Sincronizza condizioni commerciali', 'integrazioni'),
  ('integrations.sync.stocks', 'Sincronizza giacenze', 'integrazioni'),
  ('integrations.sync.list_price_commissions', 'Sincronizza provvigioni listini', 'integrazioni'),
  ('integrations.sync.orders', 'Sincronizza ordini', 'integrazioni'),
  ('integrations.sync.sales_invoices', 'Sincronizza fatture', 'integrazioni'),
  ('integrations.sync.documents', 'Sincronizza documenti', 'integrazioni')
on conflict (codice) do update set descrizione = excluded.descrizione, modulo = excluded.modulo;

alter table public.reparti_moduli
  drop constraint if exists reparti_moduli_modulo_check;
alter table public.reparti_moduli
  add constraint reparti_moduli_modulo_check check (
    modulo in (
      'beauty_days','ordini_pr','ordini_ph','prodotti','documenti',
      'progetti','attivita','agenda','messaggi','report','team','integrazioni'
    )
  );

create or replace function public.workspace_user_is_admin(target_auth_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select r.amministratore_workspace
    from public.utenti u
    join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = target_auth_user_id
      and u.attivo is not false
    limit 1
  ), false);
$$;

revoke all on function public.workspace_user_is_admin(uuid) from public;
grant execute on function public.workspace_user_is_admin(uuid) to authenticated, service_role;

-- Converte tutte le policy RLS ancora basate sulla soglia numerica al flag esplicito.
do $$
declare
  policy_row record;
  next_using text;
  next_check text;
  role_list text;
  create_sql text;
begin
  for policy_row in
    select *
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ilike '%livello%' or coalesce(with_check, '') ilike '%livello%')
  loop
    next_using := policy_row.qual;
    next_check := policy_row.with_check;

    if next_using is not null then
      next_using := regexp_replace(next_using,
        'coalesce\s*\(\s*r\.livello\s*,\s*0\s*\)\s*>=\s*(80|100)',
        'coalesce(r.amministratore_workspace, false)', 'gi');
    end if;
    if next_check is not null then
      next_check := regexp_replace(next_check,
        'coalesce\s*\(\s*r\.livello\s*,\s*0\s*\)\s*>=\s*(80|100)',
        'coalesce(r.amministratore_workspace, false)', 'gi');
    end if;

    if coalesce(next_using, '') ilike '%livello%' or coalesce(next_check, '') ilike '%livello%' then
      raise exception 'Policy %.% contiene una dipendenza da livello non convertibile automaticamente',
        policy_row.tablename, policy_row.policyname;
    end if;

    select string_agg(quote_ident(role_name), ', ')
      into role_list
    from unnest(policy_row.roles) role_name;

    execute format('drop policy %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
    create_sql := format(
      'create policy %I on %I.%I as %s for %s to %s',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename,
      policy_row.permissive,
      policy_row.cmd,
      coalesce(role_list, 'public')
    );
    if next_using is not null then create_sql := create_sql || ' using (' || next_using || ')'; end if;
    if next_check is not null then create_sql := create_sql || ' with check (' || next_check || ')'; end if;
    execute create_sql;
  end loop;
end $$;

-- La colonna numerica resta disponibile soltanto durante questa migrazione per
-- consentire la conversione atomica dei ruoli; il codice applicativo non la usa più.
comment on column public.ruoli.livello is
  'DEPRECATO: non usare. Sostituito da amministratore_workspace; rimozione dopo verifica dipendenze remote.';

commit;

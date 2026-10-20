begin;

create or replace function public.crm_normalized_contact_email(value text)
returns text language sql immutable set search_path=public as $$
  select case when btrim(value) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then lower(btrim(value)) end;
$$;

-- Private recovery/audit records never leave the database or become visible to CRM readers.
create table if not exists public.crm_customer_merge_audit (
  id uuid primary key default gen_random_uuid(), merged_account_id uuid not null unique,
  kept_account_id uuid not null, duplicate_snapshot jsonb not null, keeper_snapshot jsonb not null,
  moved_links jsonb not null default '{}', merged_at timestamptz not null default now()
);
alter table public.crm_customer_merge_audit enable row level security;
revoke all on public.crm_customer_merge_audit from public,anon,authenticated;
grant all on public.crm_customer_merge_audit to service_role;

create or replace function public.crm_merge_online_customer_service(duplicate_id uuid, keeper_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare d public.crm_accounts; k public.crm_accounts; relation record; links jsonb:='{}'; ids jsonb; col text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Servizio riservato' using errcode='42501'; end if;
  if duplicate_id=keeper_id then return; end if;
  select * into strict d from public.crm_accounts where id=duplicate_id for update;
  select * into strict k from public.crm_accounts where id=keeper_id for update;
  if d.tipo<>'online' or k.tipo<>'online' or d.codice_cliente_mexal is not null or k.codice_cliente_mexal is not null
    or public.crm_normalized_contact_email(d.email) is null
    or public.crm_normalized_contact_email(d.email) is distinct from public.crm_normalized_contact_email(k.email)
    or d.responsabile_id is distinct from k.responsabile_id or d.reparto_id is distinct from k.reparto_id then
    raise exception 'Anagrafiche non compatibili per email o perimetro';
  end if;
  if d.fonte='woocommerce' and k.fonte<>'woocommerce' then raise exception 'Conservare l’origine del sito'; end if;
  if to_regclass('public.club_members') is not null then
    if exists(select 1 from public.club_members where crm_account_id=d.id)
      and exists(select 1 from public.club_members where crm_account_id=k.id) then
      raise exception 'Due iscrizioni Club distinte: unione non automatica';
    end if;
  end if;
  -- Enumerate real foreign keys, including future customer relations. Move rows before deleting a duplicate.
  for relation in
    select c.conrelid::regclass as tab, a.attname as column_name
    from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid='public.crm_accounts'::regclass and array_length(c.conkey,1)=1
  loop
    execute format('select coalesce(jsonb_agg(id),''[]''::jsonb) from %s where %I=$1',relation.tab,relation.column_name) into ids using d.id;
    links:=links || jsonb_build_object(relation.tab::text||'.'||relation.column_name,ids);
    execute format('update %s set %I=$1 where %I=$2',relation.tab,relation.column_name,relation.column_name) using k.id,d.id;
  end loop;
  -- Workspace projects and activities also carry a text customer key.
  for relation in select table_name,column_name from information_schema.columns
    where table_schema='public' and table_name in ('crm_activities','v4_progetti','v4_fasi_progetto')
      and column_name in ('customer_key','crm_customer_key')
  loop
    execute format('select coalesce(jsonb_agg(id),''[]''::jsonb) from public.%I where %I=$1',relation.table_name,relation.column_name) into ids using 'crm:'||d.id;
    links:=links || jsonb_build_object(relation.table_name||'.'||relation.column_name,ids);
    execute format('update public.%I set %I=$1 where %I=$2',relation.table_name,relation.column_name,relation.column_name) using 'crm:'||k.id,'crm:'||d.id;
  end loop;
  if to_regclass('public.crm_customer_status') is not null then
    select coalesce(jsonb_agg(to_jsonb(s)),'[]') into ids from public.crm_customer_status s where customer_key in ('crm:'||d.id,'crm:'||k.id);
    links:=links || jsonb_build_object('crm_customer_status',ids);
    if not exists(select 1 from public.crm_customer_status where customer_key='crm:'||k.id) then
      update public.crm_customer_status set customer_key='crm:'||k.id where customer_key='crm:'||d.id;
    else
      -- A previous explicit deactivation must not become an activation through a merge.
      update public.crm_customer_status set crm_active=false where customer_key='crm:'||k.id
        and exists(select 1 from public.crm_customer_status where customer_key='crm:'||d.id and not crm_active);
      delete from public.crm_customer_status where customer_key='crm:'||d.id;
    end if;
  end if;
  insert into public.crm_customer_merge_audit(merged_account_id,kept_account_id,duplicate_snapshot,keeper_snapshot,moved_links)
    values(d.id,k.id,to_jsonb(d),to_jsonb(k),links);
  update public.crm_accounts set
    email=public.crm_normalized_contact_email(k.email),
    nome=case when nullif(k.nome,'') is null or k.nome='Nominativo non disponibile' or k.nome like '%@%' then d.nome else k.nome end,
    telefono=coalesce(nullif(k.telefono,''),d.telefono), partita_iva=coalesce(nullif(k.partita_iva,''),d.partita_iva),
    codice_fiscale=coalesce(nullif(k.codice_fiscale,''),d.codice_fiscale), indirizzo=coalesce(nullif(k.indirizzo,''),d.indirizzo),
    citta=coalesce(nullif(k.citta,''),d.citta),provincia=coalesce(nullif(k.provincia,''),d.provincia),
    cap=coalesce(nullif(k.cap,''),d.cap),paese=coalesce(nullif(k.paese,''),d.paese),
    segmenti=array(select distinct unnest(k.segmenti||d.segmenti)),
    metadati=d.metadati || k.metadati || jsonb_build_object('anagrafica',
      jsonb_strip_nulls(coalesce(d.metadati->'anagrafica','{}')) || jsonb_strip_nulls(coalesce(k.metadati->'anagrafica','{}')) ||
      jsonb_build_object('fatturazione',jsonb_strip_nulls(coalesce(d.metadati->'anagrafica'->'fatturazione','{}')) || jsonb_strip_nulls(coalesce(k.metadati->'anagrafica'->'fatturazione','{}')),
        'spedizione',jsonb_strip_nulls(coalesce(d.metadati->'anagrafica'->'spedizione','{}')) || jsonb_strip_nulls(coalesce(k.metadati->'anagrafica'->'spedizione','{}')))),
    aggiornato_il=now()
    where id=k.id;
  delete from public.crm_accounts where id=d.id;
end $$;

revoke all on function public.crm_merge_online_customer_service(uuid,uuid) from public,anon,authenticated;
grant execute on function public.crm_merge_online_customer_service(uuid,uuid) to service_role;

-- Match the user's exact normalized email rule within the same data scope.
-- Source identities and marketing-consent rows remain distinct and retain their history.
create or replace function public.crm_resolve_online_customer_service(target_connection_id uuid, profile jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare c public.crm_external_connections; a public.crm_accounts; normalized text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Servizio riservato' using errcode='42501'; end if;
  select * into strict c from public.crm_external_connections where id=target_connection_id;
  normalized:=public.crm_normalized_contact_email(profile->>'email');
  if normalized is not null then
    select * into a from public.crm_accounts where tipo='online' and codice_cliente_mexal is null
      and public.crm_normalized_contact_email(email)=normalized
      and responsabile_id is not distinct from c.responsabile_id and reparto_id is not distinct from c.reparto_id
      order by case when fonte='woocommerce' then 0 when fonte='mailchimp' then 2 else 1 end,creato_il,id limit 1 for update;
  end if;
  if a.id is null then
    insert into public.crm_accounts(tipo,nome,email,telefono,paese,fonte,responsabile_id,reparto_id,metadati)
      values('online',coalesce(profile->>'nome','Nominativo non disponibile'),coalesce(normalized,profile->>'email'),profile->>'telefono',profile->>'paese',
        c.provider_code,c.responsabile_id,c.reparto_id,jsonb_build_object('connection_id',c.id,'external_id',profile->>'external_id'))
      on conflict do nothing returning * into a;
    if a.id is null then
      select * into strict a from public.crm_accounts where tipo='online' and codice_cliente_mexal is null
        and public.crm_normalized_contact_email(email)=normalized
        and responsabile_id is not distinct from c.responsabile_id and reparto_id is not distinct from c.reparto_id;
    end if;
  end if;
  if c.provider_code='woocommerce' and a.fonte='mailchimp' then
    update public.crm_accounts set fonte='woocommerce',metadati=metadati || jsonb_build_object('connection_id',c.id,'external_id',profile->>'external_id') where id=a.id;
  end if;
  return a.id;
end $$;
revoke all on function public.crm_resolve_online_customer_service(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crm_resolve_online_customer_service(uuid,jsonb) to service_role;

-- The migration runs the same service-only merge in one transaction, with private recovery snapshots.
lock table public.crm_accounts in share row exclusive mode;
do $$
declare group_row record; keep uuid; remove uuid; ordered uuid[];
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  for group_row in select public.crm_normalized_contact_email(email) email_key,responsabile_id,reparto_id
    from public.crm_accounts where tipo='online' and codice_cliente_mexal is null and public.crm_normalized_contact_email(email) is not null
    group by 1,2,3 having count(*)>1
  loop
    select array_agg(id order by case when fonte='woocommerce' then 0 when fonte='mailchimp' then 2 else 1 end,creato_il,id) into ordered
      from public.crm_accounts where tipo='online' and codice_cliente_mexal is null
        and public.crm_normalized_contact_email(email)=group_row.email_key
        and responsabile_id is not distinct from group_row.responsabile_id and reparto_id is not distinct from group_row.reparto_id;
    keep:=ordered[1];
    foreach remove in array ordered[2:array_length(ordered,1)] loop
      perform public.crm_merge_online_customer_service(remove,keep);
    end loop;
  end loop;
end $$;

create unique index crm_online_email_scope_unique on public.crm_accounts
  (public.crm_normalized_contact_email(email),responsabile_id,reparto_id) nulls not distinct
  where tipo='online' and codice_cliente_mexal is null and public.crm_normalized_contact_email(email) is not null;

-- Both import paths must resolve identity before inserting an account. This also
-- prevents a later Mailchimp import from recreating a deleted duplicate.
do $$
declare definition text; replacement text; original text;
begin
  definition:=pg_get_functiondef('public.crm_import_commerce_page_core_service(uuid,uuid,jsonb,text,jsonb,jsonb)'::regprocedure);
  original:=definition;
  definition:=regexp_replace(definition,
    'insert into public.crm_accounts\(tipo,nome,email,telefono,paese,fonte,responsabile_id,reparto_id,metadati\)[\s\S]*?returning id into account;',
    'account:=public.crm_resolve_online_customer_service(c.id,r);');
  if definition=original then raise exception 'Importer customer creation not found'; end if;
  original:=definition;
  definition:=regexp_replace(definition,
    'insert into public.crm_accounts\(tipo,nome,email,telefono,paese,fonte,responsabile_id,reparto_id,metadati\)[\s\S]*?returning id into account;',
    'account:=public.crm_resolve_online_customer_service(c.id,r->''customer'');');
  if definition=original then raise exception 'Importer order customer creation not found'; end if;
  definition:=replace(definition,'No automatic identity merge on email alone. Each source identity remains reviewable.',
    'Resolve the normalized email within its data scope; retain separate source identities.');
  execute definition;
  definition:=pg_get_functiondef('public.crm_enrich_customer_profile_service(uuid,jsonb)'::regprocedure);
  replacement:='a:=public.crm_resolve_online_customer_service(c.id,profile);';
  original:=definition;
  definition:=regexp_replace(definition,
    'insert into public.crm_accounts\(tipo,nome,email,fonte,responsabile_id,reparto_id,metadati\)[\s\S]*?returning id into a;',replacement);
  if definition=original then raise exception 'Profile customer creation not found'; end if;
  execute definition;
end $$;

commit;

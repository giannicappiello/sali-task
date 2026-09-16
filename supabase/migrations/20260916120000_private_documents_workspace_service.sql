-- NAS links belong to Workspace. Keep all pre-existing manual links and history.
alter table public.workspace_private_documents add column if not exists codice_articolo text;
alter table public.workspace_private_documents add column if not exists percorso_nas text;
alter table public.workspace_private_documents add column if not exists origine text not null default 'manuale';
alter table public.workspace_private_documents add column if not exists note text;
create index if not exists private_documents_workspace_article on public.workspace_private_documents(codice_articolo);

with article_codes as (
  select articolo_materia_prima_mes_id id, codice_articolo_materia_prima code from public.workspace_sl_genealogy
  union select articolo_prodotto_mes_id, codice_articolo_prodotto from public.workspace_sl_genealogy
), unique_codes as (select id,min(code) code from article_codes where code<>'' group by id having count(distinct code)=1)
update public.workspace_private_documents d set codice_articolo=c.code from unique_codes c
where d.articolo_mes_id=c.id and d.codice_articolo is null;
with candidates as (
  select d.external_id,min(f.percorso) percorso from public.workspace_private_documents d
  join public.documenti_workspace f on f.nome_file=d.nome_file_originale
  where d.codice_articolo is not null
    and lower(split_part(f.percorso,'/',3))=lower(d.codice_articolo)
    and lower(split_part(f.percorso,'/',1))='produzione'
    and lower(split_part(f.percorso,'/',2))='documentazione mp'
  group by d.external_id having count(*)=1
)
update public.workspace_private_documents d set percorso_nas=c.percorso from candidates c
where d.external_id=c.external_id and d.percorso_nas is null;

create table public.workspace_private_nas_files (
  path_key text primary key, path text not null, name text not null,
  size_bytes bigint not null default 0, modified_at timestamptz, active boolean not null default true,
  scanned_at timestamptz not null default now()
);
create table public.workspace_private_document_lots (
  mexal_id bigint primary key, article_code text not null, lot_code text not null,
  customer_code text, synchronized_at timestamptz not null default now()
);
create index on public.workspace_private_document_lots(article_code);
create table public.workspace_private_document_sync (
  id integer primary key check(id=1), last_success timestamptz, lease_until timestamptz,
  lease_owner uuid, warnings jsonb not null default '[]'::jsonb
);
insert into public.workspace_private_document_sync(id) values(1);
create table public.workspace_private_document_access_log (
  id bigint generated always as identity primary key, user_id uuid not null,
  document_id uuid not null, accessed_at timestamptz not null default now()
);
alter table public.workspace_private_nas_files enable row level security;
alter table public.workspace_private_document_lots enable row level security;
alter table public.workspace_private_document_sync enable row level security;
alter table public.workspace_private_document_access_log enable row level security;
revoke all on public.workspace_private_nas_files,public.workspace_private_document_lots,public.workspace_private_document_sync,public.workspace_private_document_access_log from public,anon,authenticated;
grant all on public.workspace_private_nas_files,public.workspace_private_document_lots,public.workspace_private_document_sync,public.workspace_private_document_access_log to service_role;
grant usage,select on sequence public.workspace_private_document_access_log_id_seq to service_role;

create function public.claim_private_document_sync(owner_id uuid,force_sync boolean default false)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update workspace_private_document_sync set lease_owner=owner_id,lease_until=now()+interval '5 minutes'
  where id=1 and (lease_until is null or lease_until<now())
    and (force_sync or last_success is null or last_success<now()-interval '5 minutes');
  return found;
end $$;
revoke all on function public.claim_private_document_sync(uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_private_document_sync(uuid,boolean) to service_role;

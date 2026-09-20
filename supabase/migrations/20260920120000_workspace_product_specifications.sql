-- Product specifications live in Workspace; NAS files are referenced, never copied.
create table public.workspace_product_specifications (
  article_code text primary key,
  version integer not null check (version > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  attachments jsonb not null default '[]' check (jsonb_typeof(attachments) = 'array'),
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  updated_by_label text not null
);
create table public.workspace_product_specification_revisions (
  article_code text not null,
  version integer not null,
  data jsonb not null,
  attachments jsonb not null,
  updated_at timestamptz not null,
  updated_by uuid not null,
  updated_by_label text not null,
  primary key (article_code, version)
);
create table public.workspace_product_specification_access_log (
  id bigint generated always as identity primary key,
  article_code text not null,
  user_id uuid not null,
  attachment_id text not null,
  accessed_at timestamptz not null default now()
);
alter table public.workspace_product_specifications enable row level security;
alter table public.workspace_product_specification_revisions enable row level security;
alter table public.workspace_product_specification_access_log enable row level security;
revoke all on public.workspace_product_specifications, public.workspace_product_specification_revisions,
  public.workspace_product_specification_access_log from public, anon, authenticated;
grant all on public.workspace_product_specifications, public.workspace_product_specification_revisions,
  public.workspace_product_specification_access_log to service_role;
grant usage, select on sequence public.workspace_product_specification_access_log_id_seq to service_role;

create function public.save_workspace_product_specification(
  p_article_code text, p_expected_version integer, p_data jsonb, p_attachments jsonb,
  p_user_id uuid, p_user_label text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare saved public.workspace_product_specifications;
begin
  if p_expected_version = 0 then
    insert into workspace_product_specifications(article_code, version, data, attachments, updated_by, updated_by_label)
    values(p_article_code, 1, p_data, p_attachments, p_user_id, p_user_label)
    on conflict (article_code) do nothing returning * into saved;
  else
    update workspace_product_specifications
    set version = version + 1, data = p_data, attachments = p_attachments,
        updated_at = now(), updated_by = p_user_id, updated_by_label = p_user_label
    where article_code = p_article_code and version = p_expected_version
    returning * into saved;
  end if;
  if saved.article_code is null then
    raise exception 'Capitolato modificato da un altro utente' using errcode = '40001';
  end if;
  insert into workspace_product_specification_revisions
    (article_code, version, data, attachments, updated_at, updated_by, updated_by_label)
    values(saved.article_code, saved.version, saved.data, saved.attachments,
      saved.updated_at, saved.updated_by, saved.updated_by_label);
  return to_jsonb(saved);
end $$;
revoke all on function public.save_workspace_product_specification(text, integer, jsonb, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.save_workspace_product_specification(text, integer, jsonb, jsonb, uuid, text) to service_role;

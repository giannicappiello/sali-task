begin;

create table if not exists public.document_type_registry (
  code text primary key check (code = upper(code) and code ~ '^[A-Z0-9_]+$'),
  name text not null,
  description text,
  system text not null check (system in ('workspace','mes','both')),
  module text not null,
  category text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_letterheads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique check (code = upper(code) and code ~ '^[A-Z0-9_-]+$'),
  description text,
  company_brand text not null,
  kind text not null default 'carta_intestata',
  language text not null default 'it' check (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  format text not null check (format in ('DOCX','PDF')),
  status text not null default 'draft' check (status in ('draft','active','disabled','archived')),
  valid_from date,
  valid_to date,
  is_default boolean not null default false,
  notes text,
  created_by uuid not null references public.utenti(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.utenti(id),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create unique index if not exists company_letterheads_default_scope_uq
  on public.company_letterheads(company_brand,language)
  where is_default and status='active';

create table if not exists public.company_letterhead_versions (
  id uuid primary key default gen_random_uuid(),
  letterhead_id uuid not null references public.company_letterheads(id) on delete restrict,
  version integer not null check (version > 0),
  storage_bucket text not null default 'company-letterheads',
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in ('application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/pdf')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  preview_path text,
  valid_from date,
  valid_to date,
  created_by uuid not null references public.utenti(id),
  created_at timestamptz not null default now(),
  unique(letterhead_id,version),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create table if not exists public.company_signatures (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique check (code=upper(code) and code ~ '^[A-Z0-9_-]+$'),
  signer_name text not null,
  signer_role text,
  description text,
  status text not null default 'draft' check (status in ('draft','active','disabled','archived')),
  valid_from date,
  valid_to date,
  notes text,
  created_by uuid not null references public.utenti(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.utenti(id),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to>=valid_from)
);

create table if not exists public.company_signature_versions (
  id uuid primary key default gen_random_uuid(),
  signature_id uuid not null references public.company_signatures(id) on delete restrict,
  version integer not null check(version>0),
  storage_bucket text not null default 'company-signatures',
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null check(mime_type in ('image/png','image/jpeg')),
  size_bytes bigint not null check(size_bytes>0 and size_bytes<=10485760),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  valid_from date,
  valid_to date,
  created_by uuid not null references public.utenti(id),
  created_at timestamptz not null default now(),
  unique(signature_id,version),
  check (valid_to is null or valid_from is null or valid_to>=valid_from)
);

create table if not exists public.company_letterhead_signatures (
  id uuid primary key default gen_random_uuid(),
  letterhead_id uuid not null references public.company_letterheads(id) on delete restrict,
  signature_id uuid not null references public.company_signatures(id) on delete restrict,
  placement text not null default 'signature_block' check(placement in ('header','footer','signature_block')),
  label text,
  sort_order integer not null default 0,
  active boolean not null default true,
  valid_from date,
  valid_to date,
  created_by uuid not null references public.utenti(id),
  created_at timestamptz not null default now(),
  unique(letterhead_id,signature_id,placement),
  check (valid_to is null or valid_from is null or valid_to>=valid_from)
);

create table if not exists public.document_letterhead_rules (
  id uuid primary key default gen_random_uuid(),
  document_type_code text references public.document_type_registry(code) on delete restrict,
  letterhead_id uuid not null references public.company_letterheads(id) on delete restrict,
  scope text not null default 'global' check (scope in ('global','brand','business_area','specific')),
  brand text,
  business_area text,
  language text,
  priority integer not null default 0 check (priority between -1000 and 1000),
  active boolean not null default true,
  valid_from date,
  valid_to date,
  created_by uuid not null references public.utenti(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.utenti(id),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create unique index if not exists document_letterhead_rules_active_identity_uq
  on public.document_letterhead_rules(
    coalesce(document_type_code,'*'),scope,coalesce(brand,'*'),coalesce(business_area,'*'),coalesce(language,'*'),priority
  ) where active;

create table if not exists public.generated_document_letterheads (
  id uuid primary key default gen_random_uuid(),
  system text not null check (system in ('workspace','mes')),
  document_type_code text not null references public.document_type_registry(code),
  document_external_id text not null,
  letterhead_id uuid not null references public.company_letterheads(id) on delete restrict,
  letterhead_version_id uuid not null references public.company_letterhead_versions(id) on delete restrict,
  heading_version integer not null,
  storage_bucket text not null,
  storage_path text not null,
  resolution_rule_id uuid references public.document_letterhead_rules(id) on delete restrict,
  resolution_snapshot jsonb not null,
  issued_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique(system,document_type_code,document_external_id)
);

create table if not exists public.ai_action_registry (
  code text primary key,
  system text not null check (system in ('workspace','mes')),
  risk_level text not null check (risk_level in ('read_only','write','destructive')),
  input_schema jsonb not null,
  required_permission text,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_action_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.utenti(id),
  occurred_at timestamptz not null default now(),
  system text not null check (system in ('workspace','mes')),
  tool text not null,
  action text not null,
  target text,
  payload_summary jsonb not null default '{}'::jsonb,
  status text not null check (status in ('proposed','confirmed','executed','failed','rejected')),
  request_id uuid not null,
  correlation_id uuid not null,
  idempotency_key text,
  result jsonb,
  error text,
  confirmed_at timestamptz,
  executed_at timestamptz
);
create unique index if not exists ai_action_audit_idempotency_uq on public.ai_action_audit(user_id,tool,idempotency_key) where idempotency_key is not null;

create table if not exists public.company_letterhead_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.utenti(id),
  occurred_at timestamptz not null default now(),
  action text not null,
  target_type text not null,
  target_id text not null,
  details jsonb not null default '{}'::jsonb
);

create or replace function public.company_letterhead_current_user()
returns uuid language sql stable security definer set search_path=public as $$
  select u.id from public.utenti u where u.auth_user_id=auth.uid() and u.attivo is not false limit 1
$$;

create or replace function public.company_letterhead_can_manage()
returns boolean language sql stable security definer set search_path=public as $$
  with me as (
    select u.id,u.ruolo_id,coalesce(r.amministratore_workspace,false) admin
    from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
    where u.auth_user_id=auth.uid() and u.attivo is not false limit 1
  )
  select coalesce((select admin from me),false)
    or coalesce((public.workspace_access_context()->'permissions') ? 'settings.manage',false)
    or coalesce(public.workspace_access_context()->'module_levels'->>'impostazioni','lettura') in ('scrittura','amministrazione')
$$;

create or replace function public.company_letterhead_can_read()
returns boolean language sql stable security definer set search_path=public as $$
  select public.company_letterhead_can_manage()
    or coalesce(public.workspace_access_context()->'module_levels'->>'assistente_ai','nessuno') in ('lettura','scrittura','amministrazione')
$$;

create or replace function public.company_mes_ai_can_write()
returns boolean language sql stable security definer set search_path=public as $$
  with me as (
    select coalesce(r.amministratore_workspace,false) admin
    from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
    where u.auth_user_id=auth.uid() and u.attivo is not false limit 1
  )
  select coalesce((select admin from me),false)
    or coalesce((public.workspace_access_context()->'permissions') ? 'progremes.write',false)
    or coalesce(public.workspace_access_context()->'module_levels'->>'progremes','nessuno') in ('scrittura','amministrazione')
$$;

create or replace function public.company_letterhead_create(
  p_name text,p_code text,p_description text,p_company_brand text,p_kind text,p_language text,
  p_format text,p_valid_from date,p_valid_to date,p_is_default boolean,p_notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=public.company_letterhead_current_user(); v_id uuid;
begin
  if v_user is null or not public.company_letterhead_can_manage() then raise exception 'FORBIDDEN'; end if;
  insert into public.company_letterheads(name,code,description,company_brand,kind,language,format,valid_from,valid_to,is_default,notes,created_by,updated_by)
  values(trim(p_name),upper(trim(p_code)),nullif(trim(p_description),''),trim(p_company_brand),coalesce(nullif(trim(p_kind),''),'carta_intestata'),coalesce(nullif(trim(p_language),''),'it'),upper(trim(p_format)),p_valid_from,p_valid_to,coalesce(p_is_default,false),nullif(trim(p_notes),''),v_user,v_user)
  returning id into v_id;
  insert into public.company_letterhead_audit(user_id,action,target_type,target_id,details) values(v_user,'created','letterhead',v_id::text,jsonb_build_object('code',upper(trim(p_code))));
  return v_id;
end $$;

create or replace function public.company_letterhead_add_version(
  p_letterhead_id uuid,p_storage_path text,p_original_filename text,p_mime_type text,p_size_bytes bigint,p_sha256 text,
  p_preview_path text default null,p_valid_from date default null,p_valid_to date default null
) returns table(version_id uuid,version integer) language plpgsql security definer set search_path=public as $$
declare v_user uuid:=public.company_letterhead_current_user(); v_version integer; v_id uuid; v_format text;
begin
  if v_user is null or not public.company_letterhead_can_manage() then raise exception 'FORBIDDEN'; end if;
  select format into v_format from public.company_letterheads where id=p_letterhead_id for update;
  if v_format is null then raise exception 'NOT_FOUND'; end if;
  if (v_format='DOCX' and p_mime_type<>'application/vnd.openxmlformats-officedocument.wordprocessingml.document') or (v_format='PDF' and p_mime_type<>'application/pdf') then raise exception 'INVALID_FILE_TYPE'; end if;
  select coalesce(max(v.version),0)+1 into v_version from public.company_letterhead_versions v where v.letterhead_id=p_letterhead_id;
  insert into public.company_letterhead_versions(letterhead_id,version,storage_path,original_filename,mime_type,size_bytes,sha256,preview_path,valid_from,valid_to,created_by)
  values(p_letterhead_id,v_version,p_storage_path,p_original_filename,p_mime_type,p_size_bytes,lower(p_sha256),p_preview_path,p_valid_from,p_valid_to,v_user) returning id into v_id;
  update public.company_letterheads set updated_by=v_user,updated_at=now() where id=p_letterhead_id;
  insert into public.company_letterhead_audit(user_id,action,target_type,target_id,details) values(v_user,'version_created','letterhead',p_letterhead_id::text,jsonb_build_object('version',v_version,'version_id',v_id,'sha256',lower(p_sha256)));
  return query select v_id,v_version;
end $$;

create or replace function public.company_letterhead_set_status(p_letterhead_id uuid,p_status text,p_is_default boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid:=public.company_letterhead_current_user();
begin
  if v_user is null or not public.company_letterhead_can_manage() then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('draft','active','disabled','archived') then raise exception 'INVALID_STATUS'; end if;
  update public.company_letterheads set status=p_status,is_default=case when p_status='active' then coalesce(p_is_default,false) else false end,updated_by=v_user,updated_at=now() where id=p_letterhead_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.company_letterhead_audit(user_id,action,target_type,target_id,details) values(v_user,'status_changed','letterhead',p_letterhead_id::text,jsonb_build_object('status',p_status,'default',p_is_default));
end $$;

create or replace function public.company_signature_create(p_name text,p_code text,p_signer_name text,p_signer_role text,p_description text,p_valid_from date,p_valid_to date,p_notes text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=public.company_letterhead_current_user(); v_id uuid;
begin
  if v_user is null or not public.company_letterhead_can_manage() then raise exception 'FORBIDDEN'; end if;
  insert into public.company_signatures(name,code,signer_name,signer_role,description,valid_from,valid_to,notes,created_by,updated_by)
  values(trim(p_name),upper(trim(p_code)),trim(p_signer_name),nullif(trim(p_signer_role),''),nullif(trim(p_description),''),p_valid_from,p_valid_to,nullif(trim(p_notes),''),v_user,v_user) returning id into v_id;
  insert into public.company_letterhead_audit(user_id,action,target_type,target_id,details) values(v_user,'signature_created','signature',v_id::text,jsonb_build_object('code',upper(trim(p_code)),'signer',trim(p_signer_name)));
  return v_id;
end $$;

create or replace function public.company_signature_add_version(p_signature_id uuid,p_storage_path text,p_original_filename text,p_mime_type text,p_size_bytes bigint,p_sha256 text,p_valid_from date default null,p_valid_to date default null)
returns table(version_id uuid,version integer) language plpgsql security definer set search_path=public as $$
declare v_user uuid:=public.company_letterhead_current_user(); v_version integer; v_id uuid;
begin
  if v_user is null or not public.company_letterhead_can_manage() then raise exception 'FORBIDDEN'; end if;
  if p_mime_type not in ('image/png','image/jpeg') then raise exception 'INVALID_FILE_TYPE'; end if;
  perform 1 from public.company_signatures where id=p_signature_id for update; if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(max(sv.version),0)+1 into v_version from public.company_signature_versions sv where sv.signature_id=p_signature_id;
  insert into public.company_signature_versions(signature_id,version,storage_path,original_filename,mime_type,size_bytes,sha256,valid_from,valid_to,created_by)
  values(p_signature_id,v_version,p_storage_path,p_original_filename,p_mime_type,p_size_bytes,lower(p_sha256),p_valid_from,p_valid_to,v_user) returning id into v_id;
  update public.company_signatures set updated_by=v_user,updated_at=now() where id=p_signature_id;
  insert into public.company_letterhead_audit(user_id,action,target_type,target_id,details) values(v_user,'signature_version_created','signature',p_signature_id::text,jsonb_build_object('version',v_version,'version_id',v_id,'sha256',lower(p_sha256)));
  return query select v_id,v_version;
end $$;

create or replace function public.company_letterhead_attach_signature(p_letterhead_id uuid,p_signature_id uuid,p_placement text default 'signature_block',p_label text default null,p_sort_order integer default 0,p_valid_from date default null,p_valid_to date default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=public.company_letterhead_current_user(); v_id uuid;
begin
  if v_user is null or not public.company_letterhead_can_manage() then raise exception 'FORBIDDEN'; end if;
  insert into public.company_letterhead_signatures(letterhead_id,signature_id,placement,label,sort_order,valid_from,valid_to,created_by)
  values(p_letterhead_id,p_signature_id,p_placement,nullif(trim(p_label),''),coalesce(p_sort_order,0),p_valid_from,p_valid_to,v_user)
  on conflict(letterhead_id,signature_id,placement) do update set label=excluded.label,sort_order=excluded.sort_order,active=true,valid_from=excluded.valid_from,valid_to=excluded.valid_to
  returning id into v_id;
  insert into public.company_letterhead_audit(user_id,action,target_type,target_id,details) values(v_user,'signature_attached','letterhead',p_letterhead_id::text,jsonb_build_object('signature_id',p_signature_id,'placement',p_placement));
  return v_id;
end $$;

create or replace function public.company_letterhead_upsert_rule(
  p_rule_id uuid,p_document_type_code text,p_letterhead_id uuid,p_scope text,p_brand text,p_business_area text,p_language text,
  p_priority integer,p_active boolean,p_valid_from date,p_valid_to date
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_user uuid:=public.company_letterhead_current_user(); v_id uuid:=coalesce(p_rule_id,gen_random_uuid());
begin
  if v_user is null or not public.company_letterhead_can_manage() then raise exception 'FORBIDDEN'; end if;
  insert into public.document_letterhead_rules(id,document_type_code,letterhead_id,scope,brand,business_area,language,priority,active,valid_from,valid_to,created_by,updated_by)
  values(v_id,nullif(upper(trim(p_document_type_code)),''),p_letterhead_id,p_scope,nullif(trim(p_brand),''),nullif(trim(p_business_area),''),nullif(trim(p_language),''),coalesce(p_priority,0),coalesce(p_active,true),p_valid_from,p_valid_to,v_user,v_user)
  on conflict(id) do update set document_type_code=excluded.document_type_code,letterhead_id=excluded.letterhead_id,scope=excluded.scope,brand=excluded.brand,business_area=excluded.business_area,language=excluded.language,priority=excluded.priority,active=excluded.active,valid_from=excluded.valid_from,valid_to=excluded.valid_to,updated_by=v_user,updated_at=now();
  insert into public.company_letterhead_audit(user_id,action,target_type,target_id,details) values(v_user,case when p_rule_id is null then 'rule_created' else 'rule_updated' end,'rule',v_id::text,jsonb_build_object('document_type',p_document_type_code,'letterhead_id',p_letterhead_id));
  return v_id;
end $$;

create or replace function public.resolve_document_letterhead(p_document_type_code text,p_brand text default null,p_business_area text default null,p_language text default 'it',p_at date default current_date)
returns table(rule_id uuid,letterhead_id uuid,letterhead_code text,letterhead_name text,version_id uuid,heading_version integer,storage_bucket text,storage_path text,mime_type text,sha256 text,template_valid_until date,signature_assets jsonb,resolution jsonb)
language sql stable security definer set search_path=public as $$
  with candidates as (
    select r.*,h.code,h.name,
      (case when r.document_type_code=upper(p_document_type_code) then 32 when r.document_type_code is null then 0 else -1000 end
       +case when r.brand=p_brand and r.brand is not null then 16 when r.brand is null then 0 else -1000 end
       +case when r.business_area=p_business_area and r.business_area is not null then 8 when r.business_area is null then 0 else -1000 end
       +case when r.language=p_language and r.language is not null then 4 when r.language is null then 0 else -1000 end) specificity
    from public.document_letterhead_rules r join public.company_letterheads h on h.id=r.letterhead_id
    where (auth.role()='service_role' or public.company_letterhead_can_read())
      and r.active and h.status='active' and (r.valid_from is null or r.valid_from<=p_at) and (r.valid_to is null or r.valid_to>=p_at)
      and (h.valid_from is null or h.valid_from<=p_at) and (h.valid_to is null or h.valid_to>=p_at)
  ), selected as (select * from candidates where specificity>=0 order by specificity desc,priority desc,updated_at desc,id limit 1), version as (
    select v.* from public.company_letterhead_versions v join selected s on s.letterhead_id=v.letterhead_id
    where (v.valid_from is null or v.valid_from<=p_at) and (v.valid_to is null or v.valid_to>=p_at)
    order by v.version desc limit 1
  ), signatures as (
    select coalesce(jsonb_agg(jsonb_build_object('linkId',ls.id,'signatureId',sg.id,'signatureCode',sg.code,'signatureName',sg.name,'signerName',sg.signer_name,'signerRole',sg.signer_role,'placement',ls.placement,'label',ls.label,'versionId',sv.id,'version',sv.version,'storageBucket',sv.storage_bucket,'storagePath',sv.storage_path,'mimeType',sv.mime_type,'sha256',sv.sha256) order by ls.sort_order,sg.name),'[]'::jsonb) assets
    from selected s join public.company_letterhead_signatures ls on ls.letterhead_id=s.letterhead_id and ls.active
    join public.company_signatures sg on sg.id=ls.signature_id and sg.status='active'
    join lateral (select x.* from public.company_signature_versions x where x.signature_id=sg.id and (x.valid_from is null or x.valid_from<=p_at) and (x.valid_to is null or x.valid_to>=p_at) order by x.version desc limit 1) sv on true
    where (ls.valid_from is null or ls.valid_from<=p_at) and (ls.valid_to is null or ls.valid_to>=p_at) and (sg.valid_from is null or sg.valid_from<=p_at) and (sg.valid_to is null or sg.valid_to>=p_at)
  )
  select s.id,s.letterhead_id,s.code,s.name,v.id,v.version,v.storage_bucket,v.storage_path,v.mime_type,v.sha256,coalesce(v.valid_to,s.valid_to),coalesce(g.assets,'[]'::jsonb),
    jsonb_build_object('documentType',upper(p_document_type_code),'brand',p_brand,'businessArea',p_business_area,'language',p_language,'specificity',s.specificity,'priority',s.priority,'signatureAssets',coalesce(g.assets,'[]'::jsonb),'resolvedAt',now())
  from selected s join version v on true left join signatures g on true
$$;

create or replace function public.record_generated_document_letterhead(p_system text,p_document_type_code text,p_document_external_id text,p_issued_at timestamptz,p_brand text default null,p_business_area text default null,p_language text default 'it')
returns public.generated_document_letterheads language plpgsql security definer set search_path=public as $$
declare v_res record; v_row public.generated_document_letterheads;
begin
  select * into v_row from public.generated_document_letterheads
  where system=p_system and document_type_code=upper(p_document_type_code) and document_external_id=p_document_external_id;
  if v_row.id is not null then return v_row; end if;
  select * into v_res from public.resolve_document_letterhead(p_document_type_code,p_brand,p_business_area,p_language,p_issued_at::date);
  if v_res.version_id is null then raise exception 'LETTERHEAD_NOT_CONFIGURED'; end if;
  insert into public.generated_document_letterheads(system,document_type_code,document_external_id,letterhead_id,letterhead_version_id,heading_version,storage_bucket,storage_path,resolution_rule_id,resolution_snapshot,issued_at)
  values(p_system,upper(p_document_type_code),p_document_external_id,v_res.letterhead_id,v_res.version_id,v_res.heading_version,v_res.storage_bucket,v_res.storage_path,v_res.rule_id,v_res.resolution,p_issued_at)
  on conflict(system,document_type_code,document_external_id) do update set document_external_id=excluded.document_external_id
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.propose_heading_rule_action(p_tool text,p_payload jsonb,p_request_id uuid,p_correlation_id uuid,p_idempotency_key text)
returns public.ai_action_audit language plpgsql security definer set search_path=public as $$
declare v_user uuid:=public.company_letterhead_current_user(); v_row public.ai_action_audit;
begin
  if v_user is null then raise exception 'FORBIDDEN'; end if;
  if p_tool not in ('CREATE_HEADING_RULE','UPDATE_HEADING_RULE','DISABLE_HEADING_RULE','ATTACH_SIGNATURE_TO_HEADING','MES_DOCUMENT_GENERATE') then raise exception 'TOOL_NOT_ALLOWED'; end if;
  if p_tool='MES_DOCUMENT_GENERATE' and not public.company_mes_ai_can_write() then raise exception 'FORBIDDEN'; end if;
  if p_tool<>'MES_DOCUMENT_GENERATE' and not public.company_letterhead_can_manage() then raise exception 'FORBIDDEN'; end if;
  insert into public.ai_action_audit(user_id,system,tool,action,target,payload_summary,status,request_id,correlation_id,idempotency_key)
  values(v_user,case when p_tool='MES_DOCUMENT_GENERATE' then 'mes' else 'workspace' end,p_tool,lower(p_tool),coalesce(p_payload->>'targetId',p_payload->>'documentTypeCode',p_payload->>'ruleId'),p_payload,'proposed',p_request_id,p_correlation_id,p_idempotency_key)
  on conflict(user_id,tool,idempotency_key) where idempotency_key is not null do update set occurred_at=public.ai_action_audit.occurred_at
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.decide_external_ai_action(p_proposal_id uuid,p_confirm boolean)
returns public.ai_action_audit language plpgsql security definer set search_path=public as $$
declare v_user uuid:=public.company_letterhead_current_user(); v_action public.ai_action_audit;
begin
  if v_user is null or not public.company_mes_ai_can_write() then raise exception 'FORBIDDEN'; end if;
  select * into v_action from public.ai_action_audit where id=p_proposal_id and user_id=v_user and tool='MES_DOCUMENT_GENERATE' for update;
  if v_action.id is null then raise exception 'NOT_FOUND'; end if;
  if v_action.status in ('executed','failed','rejected') then return v_action; end if;
  if v_action.status<>'proposed' then raise exception 'INVALID_STATE'; end if;
  update public.ai_action_audit set status=case when p_confirm then 'confirmed' else 'rejected' end,
    confirmed_at=case when p_confirm then now() else null end,result=case when p_confirm then null else '{"changed":false}'::jsonb end
  where id=v_action.id returning * into v_action;
  return v_action;
end $$;

create or replace function public.complete_external_ai_action(p_proposal_id uuid,p_succeeded boolean,p_result jsonb,p_error text)
returns public.ai_action_audit language plpgsql security definer set search_path=public as $$
declare v_action public.ai_action_audit;
begin
  update public.ai_action_audit set status=case when p_succeeded then 'executed' else 'failed' end,
    executed_at=case when p_succeeded then now() else null end,result=coalesce(p_result,'{}'::jsonb),error=case when p_succeeded then null else left(p_error,1000) end
  where id=p_proposal_id and tool='MES_DOCUMENT_GENERATE' and status='confirmed' returning * into v_action;
  if v_action.id is null then raise exception 'INVALID_STATE'; end if;
  return v_action;
end $$;

create or replace function public.execute_heading_rule_action(p_proposal_id uuid,p_confirm boolean)
returns public.ai_action_audit language plpgsql security definer set search_path=public as $$
declare v_user uuid:=public.company_letterhead_current_user(); v_action public.ai_action_audit; v_rule uuid;
begin
  if v_user is null or not public.company_letterhead_can_manage() then raise exception 'FORBIDDEN'; end if;
  select * into v_action from public.ai_action_audit where id=p_proposal_id and user_id=v_user for update;
  if v_action.id is null then raise exception 'NOT_FOUND'; end if;
  if v_action.status='executed' then return v_action; end if;
  if v_action.status<>'proposed' then raise exception 'INVALID_STATE'; end if;
  if not p_confirm then update public.ai_action_audit set status='rejected',result='{"changed":false}'::jsonb where id=v_action.id returning * into v_action; return v_action; end if;
  update public.ai_action_audit set status='confirmed',confirmed_at=now() where id=v_action.id;
  if v_action.tool='ATTACH_SIGNATURE_TO_HEADING' then
    v_rule:=public.company_letterhead_attach_signature((v_action.payload_summary->>'headingId')::uuid,(v_action.payload_summary->>'signatureId')::uuid,coalesce(v_action.payload_summary->>'placement','signature_block'),v_action.payload_summary->>'label',coalesce((v_action.payload_summary->>'sortOrder')::integer,0),null,null);
  elsif v_action.tool='DISABLE_HEADING_RULE' then
    update public.document_letterhead_rules set active=false,updated_by=v_user,updated_at=now() where id=(v_action.payload_summary->>'ruleId')::uuid returning id into v_rule;
  else
    v_rule:=public.company_letterhead_upsert_rule(
      case when v_action.tool='UPDATE_HEADING_RULE' then (v_action.payload_summary->>'ruleId')::uuid else null end,
      v_action.payload_summary->>'documentTypeCode',(v_action.payload_summary->>'letterheadId')::uuid,coalesce(v_action.payload_summary->>'scope','global'),
      v_action.payload_summary->>'brand',v_action.payload_summary->>'businessArea',v_action.payload_summary->>'language',coalesce((v_action.payload_summary->>'priority')::integer,0),true,
      (v_action.payload_summary->>'validFrom')::date,(v_action.payload_summary->>'validTo')::date);
  end if;
  if v_rule is null then raise exception 'RULE_NOT_FOUND'; end if;
  update public.ai_action_audit set status='executed',executed_at=now(),result=jsonb_build_object('ruleId',v_rule,'changed',true) where id=v_action.id returning * into v_action;
  return v_action;
exception when others then
  update public.ai_action_audit set status='failed',error=left(sqlerrm,1000),result=jsonb_build_object('changed',false) where id=p_proposal_id and user_id=v_user returning * into v_action;
  return v_action;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('company-letterheads','company-letterheads',false,26214400,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('company-signatures','company-signatures',false,10485760,array['image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

alter table public.document_type_registry enable row level security;
alter table public.company_letterheads enable row level security;
alter table public.company_letterhead_versions enable row level security;
alter table public.company_signatures enable row level security;
alter table public.company_signature_versions enable row level security;
alter table public.company_letterhead_signatures enable row level security;
alter table public.document_letterhead_rules enable row level security;
alter table public.generated_document_letterheads enable row level security;
alter table public.ai_action_registry enable row level security;
alter table public.ai_action_audit enable row level security;
alter table public.company_letterhead_audit enable row level security;

create policy "authorized read document registry" on public.document_type_registry for select to authenticated using (public.company_letterhead_can_read());
create policy "authorized read letterheads" on public.company_letterheads for select to authenticated using (public.company_letterhead_can_read());
create policy "authorized read letterhead versions" on public.company_letterhead_versions for select to authenticated using (public.company_letterhead_can_read());
create policy "authorized read signatures" on public.company_signatures for select to authenticated using (public.company_letterhead_can_read());
create policy "authorized read signature versions" on public.company_signature_versions for select to authenticated using (public.company_letterhead_can_read());
create policy "authorized read letterhead signatures" on public.company_letterhead_signatures for select to authenticated using (public.company_letterhead_can_read());
create policy "authorized read letterhead rules" on public.document_letterhead_rules for select to authenticated using (public.company_letterhead_can_read());
create policy "managers read generated letterhead refs" on public.generated_document_letterheads for select to authenticated using (public.company_letterhead_can_manage());
create policy "authorized read ai action registry" on public.ai_action_registry for select to authenticated using (active and public.company_letterhead_can_read());
create policy "users read own ai heading audit" on public.ai_action_audit for select to authenticated using (user_id=public.company_letterhead_current_user() or public.company_letterhead_can_manage());
create policy "managers read letterhead audit" on public.company_letterhead_audit for select to authenticated using (public.company_letterhead_can_manage());
create policy "letterhead managers upload" on storage.objects for insert to authenticated with check (bucket_id='company-letterheads' and public.company_letterhead_can_manage());
create policy "letterhead managers update files" on storage.objects for update to authenticated using (bucket_id='company-letterheads' and public.company_letterhead_can_manage()) with check (bucket_id='company-letterheads' and public.company_letterhead_can_manage());
create policy "authorized read letterhead files" on storage.objects for select to authenticated using (bucket_id='company-letterheads' and public.company_letterhead_can_read());
create policy "signature managers upload" on storage.objects for insert to authenticated with check (bucket_id='company-signatures' and public.company_letterhead_can_manage());
create policy "signature managers update files" on storage.objects for update to authenticated using (bucket_id='company-signatures' and public.company_letterhead_can_manage()) with check (bucket_id='company-signatures' and public.company_letterhead_can_manage());
create policy "authorized read signature files" on storage.objects for select to authenticated using (bucket_id='company-signatures' and public.company_letterhead_can_read());

revoke all on public.document_type_registry,public.company_letterheads,public.company_letterhead_versions,public.company_signatures,public.company_signature_versions,public.company_letterhead_signatures,public.document_letterhead_rules,public.generated_document_letterheads,public.ai_action_registry,public.ai_action_audit,public.company_letterhead_audit from anon,authenticated;
grant select on public.document_type_registry,public.company_letterheads,public.company_letterhead_versions,public.company_signatures,public.company_signature_versions,public.company_letterhead_signatures,public.document_letterhead_rules,public.ai_action_registry to authenticated;
grant select on public.generated_document_letterheads,public.ai_action_audit,public.company_letterhead_audit to authenticated;
grant select,insert,update,delete on public.document_type_registry,public.company_letterheads,public.company_letterhead_versions,public.company_signatures,public.company_signature_versions,public.company_letterhead_signatures,public.document_letterhead_rules,public.generated_document_letterheads,public.ai_action_registry,public.ai_action_audit,public.company_letterhead_audit to service_role;
revoke all on function public.company_letterhead_can_read(),public.company_mes_ai_can_write(),public.company_letterhead_create(text,text,text,text,text,text,text,date,date,boolean,text),public.company_letterhead_add_version(uuid,text,text,text,bigint,text,text,date,date),public.company_letterhead_set_status(uuid,text,boolean),public.company_signature_create(text,text,text,text,text,date,date,text),public.company_signature_add_version(uuid,text,text,text,bigint,text,date,date),public.company_letterhead_attach_signature(uuid,uuid,text,text,integer,date,date),public.company_letterhead_upsert_rule(uuid,text,uuid,text,text,text,text,integer,boolean,date,date),public.resolve_document_letterhead(text,text,text,text,date),public.record_generated_document_letterhead(text,text,text,timestamptz,text,text,text),public.propose_heading_rule_action(text,jsonb,uuid,uuid,text),public.execute_heading_rule_action(uuid,boolean),public.decide_external_ai_action(uuid,boolean),public.complete_external_ai_action(uuid,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.company_letterhead_can_read(),public.company_mes_ai_can_write() to authenticated,service_role;
grant execute on function public.company_letterhead_create(text,text,text,text,text,text,text,date,date,boolean,text),public.company_letterhead_add_version(uuid,text,text,text,bigint,text,text,date,date),public.company_letterhead_set_status(uuid,text,boolean),public.company_signature_create(text,text,text,text,text,date,date,text),public.company_signature_add_version(uuid,text,text,text,bigint,text,date,date),public.company_letterhead_attach_signature(uuid,uuid,text,text,integer,date,date),public.company_letterhead_upsert_rule(uuid,text,uuid,text,text,text,text,integer,boolean,date,date),public.resolve_document_letterhead(text,text,text,text,date),public.propose_heading_rule_action(text,jsonb,uuid,uuid,text),public.execute_heading_rule_action(uuid,boolean),public.decide_external_ai_action(uuid,boolean) to authenticated;
grant execute on function public.resolve_document_letterhead(text,text,text,text,date),public.record_generated_document_letterhead(text,text,text,timestamptz,text,text,text),public.complete_external_ai_action(uuid,boolean,jsonb,text) to service_role;

insert into public.document_type_registry(code,name,description,system,module,category) values
('CERTIFICATO_ANALISI','Certificato di analisi','PDF CoA emesso da ProgreMES.','mes','documenti','qualita'),
('ORDINE_CLIENTE','Ordine cliente','Documento ordine generato da Workspace.','workspace','ordini','commerciale'),
('REPORT_ASSISTENTE_AI','Report Assistente AI','Report PDF generato dall’assistente Workspace.','workspace','assistente_ai','report')
on conflict(code) do update set name=excluded.name,description=excluded.description,system=excluded.system,module=excluded.module,category=excluded.category,active=true,updated_at=now();

insert into public.ai_action_registry(code,system,risk_level,input_schema,required_permission) values
('LIST_HEADINGS','workspace','read_only','{"type":"object","additionalProperties":false}'::jsonb,null),
('GET_HEADING','workspace','read_only','{"type":"object","required":["headingId"]}'::jsonb,null),
('LIST_DOCUMENT_TYPES','workspace','read_only','{"type":"object","additionalProperties":false}'::jsonb,null),
('LIST_HEADING_RULES','workspace','read_only','{"type":"object"}'::jsonb,null),
('GET_DOCUMENT_HEADING','workspace','read_only','{"type":"object","required":["documentTypeCode"]}'::jsonb,null),
('PROPOSE_HEADING_RULE','workspace','read_only','{"type":"object","required":["documentTypeCode","letterheadId"]}'::jsonb,'settings.manage'),
('CREATE_HEADING_RULE','workspace','write','{"type":"object","required":["documentTypeCode","letterheadId","scope"]}'::jsonb,'settings.manage'),
('UPDATE_HEADING_RULE','workspace','write','{"type":"object","required":["ruleId","letterheadId"]}'::jsonb,'settings.manage'),
('DISABLE_HEADING_RULE','workspace','write','{"type":"object","required":["ruleId"]}'::jsonb,'settings.manage'),
('LIST_UNASSIGNED_DOCUMENT_TYPES','workspace','read_only','{"type":"object"}'::jsonb,null),
('LIST_SIGNATURES','workspace','read_only','{"type":"object"}'::jsonb,null),
('GET_SIGNATURE','workspace','read_only','{"type":"object","required":["signatureId"]}'::jsonb,null),
('ATTACH_SIGNATURE_TO_HEADING','workspace','write','{"type":"object","required":["headingId","signatureId","placement"]}'::jsonb,'settings.manage'),
('mes.document.heading.resolve','mes','read_only','{"type":"object","required":["documentTypeCode"]}'::jsonb,'progremes.read'),
('MES_DOCUMENT_GENERATE','mes','write','{"type":"object","required":["documentTypeCode","targetId"]}'::jsonb,'progremes.write')
on conflict(code) do update set system=excluded.system,risk_level=excluded.risk_level,input_schema=excluded.input_schema,required_permission=excluded.required_permission,active=true,updated_at=now();

insert into public.workspace_schermate(codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,icona,metadati,ultima_sincronizzazione)
values('impostazioni.intestazioni_aziendali','Intestazioni aziendali','Archivio ufficiale, versioni e associazioni dei modelli documentali.','workspace','/settings/company-letterheads','settings.company-letterheads',false,true,55,'amministrazione','file-text','{"required_permissions":["settings.manage"]}'::jsonb,now())
on conflict(codice) do update set nome=excluded.nome,descrizione=excluded.descrizione,percorso=excluded.percorso,chiave_componente=excluded.chiave_componente,attiva=true,ordine=excluded.ordine,area=excluded.area,icona=excluded.icona,metadati=excluded.metadati,ultima_sincronizzazione=now();
insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values('impostazioni','impostazioni.intestazioni_aziendali',55,false,true)
on conflict(modulo_codice,schermata_codice) do update set ordine=excluded.ordine,visibile_menu=true;

commit;

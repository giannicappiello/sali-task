begin;

-- Direct content is independent of Mexal imports and PRIVATE specifications.
create table public.direct_product_sheets (
 product_id uuid primary key references public.prodotti(id) on delete cascade,
 content jsonb not null default '{}', revision integer not null default 1 check(revision>0),
 club_content jsonb, club_revision integer, updated_at timestamptz not null default now(), updated_by uuid
);
create table public.direct_product_sheet_history (
 product_id uuid references public.direct_product_sheets(product_id) on delete cascade,
 revision integer not null, content jsonb not null, saved_at timestamptz not null default now(), saved_by uuid,
 primary key(product_id,revision)
);
create table public.direct_product_sheet_templates (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 120),
 layout jsonb not null, is_default boolean not null default false, revision integer not null default 1,
 updated_at timestamptz not null default now(), updated_by uuid
);
create unique index direct_sheet_default_template on public.direct_product_sheet_templates(is_default) where is_default;
create table public.direct_product_sheet_deliveries (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.direct_product_sheets(product_id) on delete cascade,
 mapping_id uuid not null references public.crm_product_mappings(id), revision integer not null,
 status text not null check(status in ('pending','sent','accepted','error')), message text not null default '',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), actor_id uuid,
 unique(product_id,mapping_id,revision)
);

create function public.direct_product_sheet_access(write_access boolean default false,manage boolean default false)
returns boolean language sql stable security definer set search_path=public as $$
 with c as (select public.workspace_access_context() as v)
 select coalesce((v->'modules') ? 'prodotti' and
  case when manage then v->'module_levels'->>'prodotti'='amministrazione'
       when write_access then v->'module_levels'->>'prodotti' in ('scrittura','amministrazione')
       else v->'module_levels'->>'prodotti' in ('lettura','scrittura','amministrazione') end,false) from c
$$;

alter table public.direct_product_sheets enable row level security;
alter table public.direct_product_sheet_history enable row level security;
alter table public.direct_product_sheet_templates enable row level security;
alter table public.direct_product_sheet_deliveries enable row level security;
create policy "Direct sheets read" on public.direct_product_sheets for select to authenticated using(public.direct_product_sheet_access());
create policy "Direct sheet history read" on public.direct_product_sheet_history for select to authenticated using(public.direct_product_sheet_access());
create policy "Direct templates read" on public.direct_product_sheet_templates for select to authenticated using(public.direct_product_sheet_access());
create policy "Direct deliveries read" on public.direct_product_sheet_deliveries for select to authenticated using(public.direct_product_sheet_access());
revoke all on public.direct_product_sheets,public.direct_product_sheet_history,public.direct_product_sheet_templates,public.direct_product_sheet_deliveries from anon,authenticated;
grant select on public.direct_product_sheets,public.direct_product_sheet_history,public.direct_product_sheet_templates,public.direct_product_sheet_deliveries to authenticated;
grant all on public.direct_product_sheets,public.direct_product_sheet_history,public.direct_product_sheet_templates,public.direct_product_sheet_deliveries to service_role;
create view public.direct_product_sheet_summaries with(security_invoker=true) as
 select product_id,revision,club_revision,updated_at,
 (select count(*)::integer from unnest(array['description','features','active_ingredients','inci','directions','warnings'])k where length(btrim(coalesce(content->>k,'')))>0) as filled_count
 from public.direct_product_sheets;
grant select on public.direct_product_sheet_summaries to authenticated,service_role;

create function public.direct_save_product_sheet(target_id uuid,payload jsonb,expected_revision integer default 0)
returns public.direct_product_sheets language plpgsql security definer set search_path=public as $$
declare current_row public.direct_product_sheets; saved public.direct_product_sheets; clean jsonb:='{}'; k text;
begin
 if not public.direct_product_sheet_access(true) then raise exception 'Compilazione scheda non autorizzata.' using errcode='42501';end if;
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) a where a<>all(array['description','features','active_ingredients','inci','directions','warnings'])) then raise exception 'Campi scheda non validi.';end if;
 foreach k in array array['description','features','active_ingredients','inci','directions','warnings'] loop
  if payload ? k and jsonb_typeof(payload->k)<>'string' then raise exception 'Il testo dei campi non è valido.';end if;
  if length(coalesce(payload->>k,''))>12000 then raise exception 'Ogni campo può contenere al massimo 12000 caratteri.';end if;
  clean:=clean||jsonb_build_object(k,btrim(coalesce(payload->>k,'')));
 end loop;
 if not exists(select 1 from public.prodotti p where p.id=target_id and coalesce(nullif(p.codice_mexal,''),p.codice) ~* '^(IT|MKT)') then raise exception 'Prodotto Direct non disponibile.';end if;
 perform pg_advisory_xact_lock(hashtextextended(target_id::text,0));
 select * into current_row from public.direct_product_sheets where product_id=target_id for update;
 if coalesce(current_row.revision,0) is distinct from expected_revision then raise exception 'La scheda è stata modificata da un altro utente. Riaprila prima di salvare.' using errcode='40001';end if;
 insert into public.direct_product_sheets(product_id,content,revision,updated_by) values(target_id,clean,1,auth.uid())
 on conflict(product_id) do update set content=excluded.content,revision=direct_product_sheets.revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() returning * into saved;
 insert into public.direct_product_sheet_history(product_id,revision,content,saved_by) values(saved.product_id,saved.revision,saved.content,auth.uid());
 return saved;
end $$;

create function public.direct_publish_product_sheet_club(target_id uuid,expected_revision integer)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.direct_product_sheet_access(true,true) then raise exception 'Pubblicazione scheda non autorizzata.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(target_id::text,0));
 if not exists(select 1 from public.direct_product_sheets s where product_id=target_id and revision=expected_revision and
  not exists(select 1 from unnest(array['description','features','active_ingredients','inci','directions','warnings'])k where length(btrim(coalesce(s.content->>k,'')))=0)) then raise exception 'Salva e completa tutti i sei campi prima di pubblicare.';end if;
 update public.direct_product_sheets set club_content=content,club_revision=revision where product_id=target_id;
end $$;

create function public.direct_validate_sheet_layout(value jsonb) returns boolean language plpgsql immutable set search_path=public as $$
declare p jsonb;b jsonb;key text;
begin
 if jsonb_typeof(value)<>'object' or pg_column_size(value)>8000000 or jsonb_typeof(value->'pages') is distinct from 'array' or jsonb_typeof(value->'boxes') is distinct from 'array' then return false;end if;
 if jsonb_array_length(value->'pages')<>1 or jsonb_array_length(value->'boxes') not between 1 and 60 then return false;end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(value->'pages')x)<>jsonb_array_length(value->'pages') or (select count(distinct x->>'id') from jsonb_array_elements(value->'boxes')x)<>jsonb_array_length(value->'boxes') then return false;end if;
 for p in select * from jsonb_array_elements(value->'pages') loop
  if length(coalesce(p->>'id','')) not between 1 and 80 or jsonb_typeof(p->'width') is distinct from 'number' or jsonb_typeof(p->'height') is distinct from 'number' or (p->>'width')::numeric not between 100 and 2000 or (p->>'height')::numeric not between 100 and 2000 then return false;end if;
  if coalesce(p->>'background','')<>'' and (length(p->>'background')>3000000 or p->>'background' !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$') then return false;end if;
 end loop;
 for b in select * from jsonb_array_elements(value->'boxes') loop
  if length(coalesce(b->>'id','')) not between 1 and 80 or not exists(select 1 from jsonb_array_elements(value->'pages')page_entry where page_entry->>'id'=b->>'page') then return false;end if;
  if coalesce(b->>'field','')<>all(array['photo','name','code','ean','category','format','description','features','active_ingredients','inci','directions','warnings']) then return false;end if;
  foreach key in array array['x','y','width','height','fontSize'] loop
   if jsonb_typeof(b->key) is distinct from 'number' then return false;end if;
  end loop;
  if (b->>'x')::numeric<0 or (b->>'y')::numeric<0 or (b->>'width')::numeric not between 2 and 100 or (b->>'height')::numeric not between 2 and 100 or (b->>'x')::numeric+(b->>'width')::numeric>100.001 or (b->>'y')::numeric+(b->>'height')::numeric>100.001 or (b->>'fontSize')::numeric not between 6 and 60 then return false;end if;
  if coalesce(b->>'font','')<>all(array['helvetica','times','courier']) or coalesce(b->>'align','')<>all(array['left','center','right','justify']) or coalesce(b->>'vertical','')<>all(array['top','middle','bottom']) or coalesce(b->>'color','') !~ '^#[0-9a-fA-F]{6}$' or jsonb_typeof(b->'bold') is distinct from 'boolean' or jsonb_typeof(b->'showLabel') is distinct from 'boolean' then return false;end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create function public.direct_save_sheet_template(target_id uuid,template_name text,template_layout jsonb,make_default boolean,expected_revision integer default 0)
returns public.direct_product_sheet_templates language plpgsql security definer set search_path=public as $$
declare current_row public.direct_product_sheet_templates; saved public.direct_product_sheet_templates;
begin
 if not public.direct_product_sheet_access(true,true) then raise exception 'Gestione template non autorizzata.' using errcode='42501';end if;
 if length(btrim(template_name)) not between 1 and 120 or not public.direct_validate_sheet_layout(template_layout) then raise exception 'Nome o disposizione del template non validi.';end if;
 perform pg_advisory_xact_lock(hashtextextended('direct-sheet-templates',0));
 if target_id is not null then select * into current_row from public.direct_product_sheet_templates where id=target_id for update;end if;
 if coalesce(current_row.revision,0) is distinct from expected_revision then raise exception 'Template aggiornato da un altro utente. Riaprilo prima di salvare.' using errcode='40001';end if;
 if target_id is not null and current_row.id is null then raise exception 'Template non disponibile.';end if;
 if make_default then update public.direct_product_sheet_templates set is_default=false,revision=revision+1,updated_at=clock_timestamp() where is_default and id is distinct from target_id;end if;
 insert into public.direct_product_sheet_templates(id,name,layout,is_default,updated_by) values(coalesce(target_id,gen_random_uuid()),btrim(template_name),template_layout,make_default,auth.uid())
 on conflict(id) do update set name=excluded.name,layout=excluded.layout,is_default=excluded.is_default,revision=direct_product_sheet_templates.revision+1,updated_at=clock_timestamp(),updated_by=auth.uid() returning * into saved;
 return saved;
end $$;

-- Add shared published texts without changing eligibility, visibility, media or prices.
create or replace function public.club_catalog_product_json(target_id uuid,full_text boolean default false) returns jsonb language sql stable security definer set search_path=public as $$
 with base as (select public.club_catalog_product_base_json(target_id,full_text) as data), sheet as
 (select club_content,club_revision from public.direct_product_sheets where product_id=target_id and club_content is not null)
 select case when base.data is null then null else base.data||jsonb_build_object('pricing',public.club_product_pricing(target_id,public.club_viewer_store()))||
 case when sheet.club_content is null then '{}'::jsonb else jsonb_build_object('description',case when full_text then sheet.club_content->>'description' else left(sheet.club_content->>'description',220) end,'product_sheet',case when full_text then sheet.club_content else null end,'product_sheet_revision',sheet.club_revision) end end
 from base left join sheet on true
$$;

revoke all on function public.direct_product_sheet_access(boolean,boolean),public.direct_save_product_sheet(uuid,jsonb,integer),public.direct_publish_product_sheet_club(uuid,integer),public.direct_save_sheet_template(uuid,text,jsonb,boolean,integer),public.direct_validate_sheet_layout(jsonb) from public,anon;
grant execute on function public.direct_product_sheet_access(boolean,boolean),public.direct_save_product_sheet(uuid,jsonb,integer),public.direct_publish_product_sheet_club(uuid,integer),public.direct_save_sheet_template(uuid,text,jsonb,boolean,integer) to authenticated;
grant execute on function public.direct_product_sheet_access(boolean,boolean),public.direct_save_product_sheet(uuid,jsonb,integer),public.direct_publish_product_sheet_club(uuid,integer),public.direct_save_sheet_template(uuid,text,jsonb,boolean,integer),public.direct_validate_sheet_layout(jsonb) to service_role;

commit;

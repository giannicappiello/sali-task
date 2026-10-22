begin;
create table public.direct_product_sheet_translations (
 product_id uuid references public.direct_product_sheets(product_id) on delete cascade,
 language text not null check(language in ('ENG','FR','DE','ES','PT')),content jsonb not null,
 source_revision integer not null,revision integer not null default 1,reviewed boolean not null default false,
 updated_at timestamptz not null default now(),updated_by uuid,primary key(product_id,language)
);
create table public.direct_product_sheet_archives (
 id uuid primary key default gen_random_uuid(),product_id uuid not null references public.direct_product_sheets(product_id) on delete cascade,
 template_id uuid not null references public.direct_product_sheet_templates(id),template_revision integer not null,
 source_revision integer not null,languages jsonb not null,filename text not null,sha256 text not null,
 size_bytes integer not null,issued_at bigint not null,status text not null default 'pending' check(status in ('pending','saved','error')),
 folder text not null,created_at timestamptz not null default now(),created_by uuid
);
alter table public.direct_product_sheet_translations enable row level security;
alter table public.direct_product_sheet_archives enable row level security;
create policy "Direct translations read" on public.direct_product_sheet_translations for select to authenticated using(public.direct_product_sheet_access());
create policy "Direct archive read" on public.direct_product_sheet_archives for select to authenticated using(public.direct_product_sheet_access());
revoke all on public.direct_product_sheet_translations,public.direct_product_sheet_archives from anon,authenticated;
grant select on public.direct_product_sheet_translations,public.direct_product_sheet_archives to authenticated;
grant all on public.direct_product_sheet_translations,public.direct_product_sheet_archives to service_role;

create function public.direct_save_sheet_translation(target_id uuid,target_language text,payload jsonb,source_revision integer,expected_revision integer default 0,is_reviewed boolean default false)
returns public.direct_product_sheet_translations language plpgsql security definer set search_path=public as $$
declare source public.direct_product_sheets;previous public.direct_product_sheet_translations;saved public.direct_product_sheet_translations;clean jsonb:='{}';k text;
begin
 if not public.direct_product_sheet_access(true) then raise exception 'Traduzione scheda non autorizzata.' using errcode='42501';end if;
 if target_language is null or target_language<>all(array['ENG','FR','DE','ES','PT']) then raise exception 'Lingua non valida.';end if;
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload)a where a<>all(array['description','features','active_ingredients','inci','directions','warnings'])) then raise exception 'Campi traduzione non validi.';end if;
 perform pg_advisory_xact_lock(hashtextextended(target_id::text,0));
 select * into source from public.direct_product_sheets where product_id=target_id for update;
 if source.product_id is null or source.revision is distinct from source_revision then raise exception 'La scheda italiana è cambiata. Rigenera o rivedi la traduzione.' using errcode='40001';end if;
 foreach k in array array['description','features','active_ingredients','inci','directions','warnings'] loop
  if payload ? k and jsonb_typeof(payload->k)<>'string' then raise exception 'Il testo tradotto non è valido.';end if;
  if length(coalesce(payload->>k,''))>12000 then raise exception 'Ogni campo può contenere al massimo 12000 caratteri.';end if;
  clean:=clean||jsonb_build_object(k,btrim(coalesce(payload->>k,'')));
  if is_reviewed and btrim(coalesce(payload->>k,''))='' then raise exception 'Completa tutti i sei campi prima di approvare la traduzione.';end if;
 end loop;
 if clean->>'inci' is distinct from source.content->>'inci' then raise exception 'L’INCI/CTFA deve restare identico al testo italiano.';end if;
 select * into previous from public.direct_product_sheet_translations t where t.product_id=target_id and t.language=target_language for update;
 if coalesce(previous.revision,0) is distinct from expected_revision then raise exception 'Traduzione modificata da un altro utente. Riaprila prima di salvare.' using errcode='40001';end if;
 insert into public.direct_product_sheet_translations(product_id,language,content,source_revision,reviewed,updated_by)
 values(target_id,target_language,clean,source_revision,is_reviewed,auth.uid())
 on conflict(product_id,language) do update set content=excluded.content,source_revision=excluded.source_revision,reviewed=excluded.reviewed,revision=direct_product_sheet_translations.revision+1,updated_at=clock_timestamp(),updated_by=auth.uid() returning * into saved;
 return saved;
end $$;
revoke all on function public.direct_save_sheet_translation(uuid,text,jsonb,integer,integer,boolean) from public,anon;
grant execute on function public.direct_save_sheet_translation(uuid,text,jsonb,integer,integer,boolean) to authenticated,service_role;
commit;

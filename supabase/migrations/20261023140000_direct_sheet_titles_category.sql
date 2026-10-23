begin;
create or replace function public.direct_save_sheet_translation(target_id uuid,target_language text,payload jsonb,source_revision integer,expected_revision integer default 0,is_reviewed boolean default false)
returns public.direct_product_sheet_translations language plpgsql security definer set search_path=public as $$
declare source public.direct_product_sheets;previous public.direct_product_sheet_translations;saved public.direct_product_sheet_translations;clean jsonb:='{}';k text;category_source text;
begin
 if not public.direct_product_sheet_access(true) then raise exception 'Traduzione scheda non autorizzata.' using errcode='42501';end if;
 if target_language is null or target_language<>all(array['ENG','FR','DE','ES','PT']) then raise exception 'Lingua non valida.';end if;
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload)a where a<>all(array['description','features','active_ingredients','inci','directions','warnings','category','category_source'])) then raise exception 'Campi traduzione non validi.';end if;
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
 select btrim(coalesce(categoria_mexal,'')) into category_source from public.prodotti where id=target_id;
 if payload ? 'category' then
  if jsonb_typeof(payload->'category')<>'string' or length(payload->>'category')>12000 then raise exception 'Categoria tradotta non valida.';end if;
  if payload ? 'category_source' and (jsonb_typeof(payload->'category_source')<>'string' or length(payload->>'category_source')>12000) then raise exception 'Categoria di origine non valida.';end if;
  clean:=clean||jsonb_build_object('category',btrim(payload->>'category'),'category_source',coalesce(payload->>'category_source',''));
 end if;
 if is_reviewed and coalesce(category_source,'')<>'' and (btrim(coalesce(payload->>'category',''))='' or payload->>'category_source' is distinct from category_source) then raise exception 'Traduci e verifica la categoria aggiornata prima di approvare.';end if;
 select * into previous from public.direct_product_sheet_translations t where t.product_id=target_id and t.language=target_language for update;
 if coalesce(previous.revision,0) is distinct from expected_revision then raise exception 'Traduzione modificata da un altro utente. Riaprila prima di salvare.' using errcode='40001';end if;
 insert into public.direct_product_sheet_translations(product_id,language,content,source_revision,reviewed,updated_by)
 values(target_id,target_language,clean,source_revision,is_reviewed,auth.uid())
 on conflict(product_id,language) do update set content=excluded.content,source_revision=excluded.source_revision,reviewed=excluded.reviewed,revision=direct_product_sheet_translations.revision+1,updated_at=clock_timestamp(),updated_by=auth.uid() returning * into saved;
 return saved;
end $$;

create or replace function public.direct_validate_sheet_layout(value jsonb) returns boolean language plpgsql immutable set search_path=public as $$
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
  if b ? 'kind' and (jsonb_typeof(b->'kind') is distinct from 'string' or b->>'kind'<>all(array['title','value'])) then return false;end if;
  if b->>'kind'='title' and b->>'field'='photo' then return false;end if;
  if b ? 'lockAspect' and jsonb_typeof(b->'lockAspect') is distinct from 'boolean' then return false;end if;
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


notify pgrst,'reload schema';
commit;

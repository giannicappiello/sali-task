begin;
create table public.club_catalog_pdf_sections(id text primary key,parent_id text references public.club_catalog_pdf_sections(id),name text not null,position integer not null);
create table public.club_catalog_pdf_items(code text not null,section_id text references public.club_catalog_pdf_sections(id),position integer not null,pdf_page integer not null,primary key(code,section_id));
alter table public.club_catalog_products add column display_position integer check(display_position>0);
create table public.club_catalog_order_state(id boolean primary key default true check(id),audit_id uuid not null default gen_random_uuid(),revision integer not null default 0);
insert into public.club_catalog_order_state default values;
insert into club_catalog_pdf_sections values
('viso',null,'Viso',10),
('viso-cleanse','viso','Cleanse · Detersione',11),
('viso-shot','viso','Shot · Esfoliazione',12),
('viso-active','viso','Active · Stimolazione',13),
('viso-boost','viso','Boost · Trattamento',14),
('viso-cream','viso','Cream · Nutrimento',15),
('corpo',null,'Corpo',20),
('corpo-esfoliazione','corpo','Esfoliazione',21),
('corpo-stimolazione','corpo','Stimolazione',22),
('corpo-trattamento','corpo','Trattamento',23),
('corpo-creme','corpo','Nutrimento · Creme',24),
('corpo-oli','corpo','Nutrimento · Oli',25),
('corpo-post-epilazione','corpo','Post epilazione',26),
('gesti',null,'Gesti quotidiani',30),
('gesti-capelli','gesti','Capelli',31),
('gesti-corpo','gesti','Corpo',32),
('gesti-mani','gesti','Mani',33),
('gesti-piedi','gesti','Piedi',34),
('gesti-deodoranti','gesti','Deodoranti e intimo',35),
('solari',null,'Solari',40),
('solari-protezioni','solari','Protezioni solari',41),
('solari-doposole','solari','Doposole',42),
('sensoriale',null,'Esperienza sensoriale',50),
('sensoriale-eau','sensoriale','Eau de parfum',51),
('sensoriale-home','sensoriale','Home parfum',52),
('altri',null,'Altri prodotti',99);
insert into club_catalog_pdf_items values
('IT0208','viso-cleanse',1,5),
('IT0568','viso-cleanse',2,5),
('IT0197','viso-cleanse',3,5),
('IT0569','viso-cleanse',4,5),
('IT0191','viso-cleanse',5,5),
('IT0192','viso-cleanse',6,5),
('IT0190','viso-cleanse',7,5),
('IT0498','viso-cleanse',8,5),
('IT0085','viso-shot',9,6),
('IT0052','viso-shot',10,6),
('IT0086','viso-shot',11,6),
('IT0468','viso-shot',12,6),
('IT0040','viso-active',13,7),
('IT0019','viso-active',14,7),
('IT0472','viso-active',15,7),
('IT0473','viso-active',16,7),
('IT0475','viso-active',17,7),
('IT0087','viso-boost',18,8),
('IT0039','viso-boost',19,8),
('IT0474','viso-boost',20,8),
('IT0119','viso-boost',21,8),
('IT0121','viso-boost',22,8),
('IT0466','viso-boost',23,8),
('IT0467','viso-boost',24,8),
('IT0476','viso-boost',25,8),
('IT0491','viso-cream',26,9),
('IT0470','viso-cream',27,9),
('IT0489','viso-cream',28,9),
('IT0492','viso-cream',29,9),
('IT0490','viso-cream',30,9),
('IT0512','viso-cream',31,9),
('IT0480','viso-cream',32,9),
('IT0204','viso-cream',33,9),
('IT0513','viso-cream',34,9),
('IT0091','corpo-esfoliazione',35,11),
('IT0092','corpo-esfoliazione',36,11),
('IT0427','corpo-stimolazione',37,11),
('IT0428','corpo-stimolazione',38,11),
('IT0426','corpo-stimolazione',39,11),
('IT0055','corpo-stimolazione',40,11),
('IT0017','corpo-trattamento',41,12),
('IT0105','corpo-trattamento',42,12),
('IT0104','corpo-trattamento',43,12),
('IT0450','corpo-trattamento',44,12),
('IT0449','corpo-creme',45,13),
('IT0447','corpo-creme',46,13),
('IT0448','corpo-creme',47,13),
('IT0056','corpo-creme',48,13),
('IT0057','corpo-creme',49,13),
('IT0058','corpo-creme',50,13),
('IT0060','corpo-creme',51,13),
('IT0035','corpo-creme',52,13),
('IT0440','corpo-oli',53,14),
('IT0441','corpo-oli',54,14),
('IT0099','corpo-oli',55,14),
('IT0093','corpo-oli',56,14),
('IT0096','corpo-oli',57,14),
('IT0100','corpo-oli',58,14),
('IT0097','corpo-oli',59,14),
('IT0036','corpo-post-epilazione',60,15),
('IT0037','corpo-post-epilazione',61,15),
('IT0419','gesti-capelli',62,17),
('IT0420','gesti-capelli',63,17),
('IT0418','gesti-capelli',64,17),
('IT0471','gesti-capelli',65,17),
('IT0556','gesti-capelli',66,17),
('IT0084','gesti-corpo',67,18),
('IT0083','gesti-corpo',68,18),
('IT0082','gesti-corpo',69,18),
('IT0460','gesti-corpo',70,18),
('IT0461','gesti-corpo',71,18),
('IT0462','gesti-corpo',72,18),
('IT0506','gesti-mani',73,19),
('IT0507','gesti-mani',74,19),
('IT0508','gesti-mani',75,19),
('IT0038','gesti-piedi',76,19),
('IT0077','gesti-piedi',77,19),
('IT0509','gesti-mani',78,19),
('IT0510','gesti-mani',79,19),
('IT0511','gesti-mani',80,19),
('IT0076','gesti-piedi',81,19),
('IT0078','gesti-piedi',82,19),
('IT0527','gesti-deodoranti',83,20),
('IT0528','gesti-deodoranti',84,20),
('IT0529','gesti-deodoranti',85,20),
('IT0010','gesti-deodoranti',86,20),
('IT0001','gesti-deodoranti',87,20),
('IT0562','solari-protezioni',88,22),
('IT0561','solari-protezioni',89,22),
('IT0560','solari-protezioni',90,22),
('IT0564','solari-protezioni',91,22),
('IT0563','solari-protezioni',92,22),
('IT0217','solari-protezioni',93,22),
('IT0526','solari-doposole',94,23),
('IT0559','solari-doposole',95,23),
('IT0525','solari-doposole',96,23),
('IT0558','solari-doposole',97,23),
('IT0556','solari-doposole',98,23),
('IT0011','sensoriale-eau',99,25),
('IT0547','sensoriale-eau',100,25),
('IT0012','sensoriale-eau',101,25),
('IT0004','sensoriale-eau',102,25),
('IT0550','sensoriale-eau',103,25),
('IT0545','sensoriale-eau',104,25),
('IT0546','sensoriale-eau',105,25),
('IT0551','sensoriale-eau',106,25),
('IT0549','sensoriale-eau',107,25),
('IT0005','sensoriale-eau',108,25),
('IT0013','sensoriale-eau',109,25),
('IT0548','sensoriale-eau',110,25),
('IT0539','sensoriale-home',111,26),
('IT0540','sensoriale-home',112,26),
('IT0543','sensoriale-home',113,26),
('IT0544','sensoriale-home',114,26),
('IT0541','sensoriale-home',115,26),
('IT0542','sensoriale-home',116,26);
do $$declare t text;begin
 foreach t in array array['club_catalog_pdf_sections','club_catalog_pdf_items','club_catalog_order_state'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create function public.club_workspace_document_matches(d public.documenti_workspace,p public.prodotti) returns boolean language sql immutable as $$
 select coalesce(d.attivo and d.sezione_id is not null and (d.prodotto_id=p.id or
 exists(select 1 from unnest(d.categorie_prodotto) x where btrim(coalesce(p.categoria_mexal,''))<>'' and lower(btrim(x))=lower(btrim(p.categoria_mexal))) or
 exists(select 1 from unnest(d.brand_prodotti) x where btrim(coalesce(p.brand_mexal,''))<>'' and lower(btrim(x))=lower(btrim(p.brand_mexal))) or
 exists(select 1 from unnest(d.linee_prodotto) x where btrim(coalesce(p.linea_mexal,''))<>'' and lower(btrim(x))=lower(btrim(p.linea_mexal)))),false);
$$;
create function public.club_product_materials(target_id uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',d.titolo,'kind',d.mime_group,'section',s.nome,'cover',coalesce(m.is_cover,false)) order by coalesce(m.is_cover,false) desc,coalesce(m.position,100000),s.nome,d.titolo,d.id),'[]')
 from public.prodotti p join public.club_catalog_products c on c.product_id=p.id
 join public.documenti_workspace d on d.attivo and (public.club_workspace_document_matches(d,p) or exists(select 1 from public.club_catalog_product_media x where x.product_id=p.id and x.document_id=d.id))
 left join public.club_catalog_product_media m on m.product_id=p.id and m.document_id=d.id left join public.sezioni_documentali s on s.id=d.sezione_id
 where p.id=target_id and c.visible and public.club_catalog_eligible(p);
$$;
create or replace function public.club_catalog_product_base_json(target_id uuid,full_text boolean default false) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',p.id,'name',c.display_name,'code',p.codice_mexal,
 'description',case when full_text then c.description else left(c.description,220) end,'website_url',c.website_url,
 'image_url',case when coalesce(to_jsonb(p)->>'immagine_catalogo_url',to_jsonb(p)->>'immagine_url','') ~ '^https://' then coalesce(to_jsonb(p)->>'immagine_catalogo_url',to_jsonb(p)->>'immagine_url') else null end,
 'category_ids',coalesce((select jsonb_agg(category_id order by category_id) from public.club_catalog_product_categories where product_id=p.id),'[]'),
 'media',case when full_text then public.club_product_materials(p.id) else coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'title',d.titolo,'kind',d.mime_group,'cover',m.is_cover) order by m.is_cover desc,m.position,d.titolo)
 from public.club_catalog_product_media m join public.documenti_workspace d on d.id=m.document_id where m.product_id=p.id and d.attivo),'[]') end)
 from public.prodotti p join public.club_catalog_products c on c.product_id=p.id where p.id=target_id and c.visible and public.club_catalog_eligible(p);
$$;
create or replace function public.club_media_paths(document_ids uuid[],viewer_auth_id uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if cardinality(document_ids)>40 then raise exception 'Troppi materiali richiesti.';end if;
 perform set_config('request.jwt.claim.sub',coalesce(viewer_auth_id::text,''),true);
 perform set_config('request.jwt.claim.role',case when viewer_auth_id is null then 'anon' else 'authenticated' end,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',viewer_auth_id,'role',case when viewer_auth_id is null then 'anon' else 'authenticated' end)::text,true);
 return coalesce((select jsonb_object_agg(d.id,d.percorso) from public.documenti_workspace d where d.id=any(document_ids) and d.attivo and (
 exists(select 1 from public.club_catalog_products c join public.prodotti p on p.id=c.product_id where c.visible and public.club_catalog_eligible(p) and (public.club_workspace_document_matches(d,p) or exists(select 1 from public.club_catalog_product_media m where m.product_id=p.id and m.document_id=d.id)))
 or exists(select 1 from public.club_post_media m join public.club_posts p on p.id=m.post_id where m.document_id=d.id and p.status='published' and p.starts_at<=now() and (p.ends_at is null or p.ends_at>now()) and p.audience=any(public.club_content_audiences())))),'{}');
end $$;
create function public.club_catalog_query(search_text text,category_id integer,page_offset integer,target_section text) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if length(search_text)>200 or page_offset<0 or (target_section is not null and not exists(select 1 from club_catalog_pdf_sections s where s.id=target_section)) then raise exception 'Ricerca non valida.';end if;
 return (with recursive categories(id) as (select c.id from club_catalog_categories c where c.id=category_id and c.active union select c.id from club_catalog_categories c join categories parent on c.parent_id=parent.id where c.active),
 sections(id) as(select s.id from club_catalog_pdf_sections s where s.id=target_section union select s.id from club_catalog_pdf_sections s join sections a on s.parent_id=a.id),
 category_labels(product_id,id,name,parent_id) as(select pc.product_id,c.id,c.name,c.parent_id from club_catalog_product_categories pc join club_catalog_categories c on c.id=pc.category_id union select l.product_id,c.id,c.name,c.parent_id from category_labels l join club_catalog_categories c on c.id=l.parent_id),
 filtered as materialized(select p.id,c.display_name,p.codice_mexal,coalesce(c.display_position,ranked.rank,990000) as sort_position,coalesce(ranked.rank,990000) as pdf_position,coalesce(ranked.section_id,'altri') as catalog_group,coalesce(ranked.label,'Altri prodotti') as catalog_group_name
 from prodotti p join club_catalog_products c on c.product_id=p.id
 left join lateral(select i.section_id,s.position*1000+i.position as rank,concat_ws(' · ',parent.name,s.name) as label from club_catalog_pdf_items i join club_catalog_pdf_sections s on s.id=i.section_id left join club_catalog_pdf_sections parent on parent.id=s.parent_id
 where i.code=upper(btrim(p.codice_mexal)) and (target_section is null or i.section_id in(select id from sections)) order by s.position,i.position limit 1) ranked on true
 where c.visible and club_catalog_eligible(p)
 and (target_section is null or ranked.section_id is not null or (target_section='altri' and not exists(select 1 from club_catalog_pdf_items i where i.code=upper(btrim(p.codice_mexal)))))
 and (category_id is null or exists(select 1 from club_catalog_product_categories pc where pc.product_id=p.id and pc.category_id in(select id from categories)))
 and not exists(select 1 from unnest(regexp_split_to_array(lower(btrim(coalesce(search_text,''))),'\s+')) word where word<>'' and position(word in lower(concat_ws(' ',c.display_name,c.description,p.codice_mexal,to_jsonb(p)->>'ean',ranked.label,(select string_agg(cl.name,' ') from category_labels cl where cl.product_id=p.id))))=0))
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(club_catalog_product_json(id)||jsonb_build_object('catalog_group',catalog_group,'catalog_group_name',catalog_group_name) order by sort_position,pdf_position,display_name,codice_mexal,id) from(select * from filtered order by sort_position,pdf_position,display_name,codice_mexal,id limit 24 offset page_offset)x),'[]')));
end $$;
create or replace function public.club_catalog_products(search_text text default '',category_id integer default null,page_offset integer default 0) returns jsonb language sql stable security definer set search_path=public as $$ select club_catalog_query(search_text,category_id,page_offset,null); $$;
create function public.club_browse_catalog(search_text text default '',category_id integer default null,page_offset integer default 0,section_id text default null) returns jsonb language sql stable security definer set search_path=public as $$ select club_catalog_query(search_text,category_id,page_offset,section_id); $$;
create function public.club_pdf_sections() returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'parent_id',parent_id,'name',name) order by position,id),'[]') from club_catalog_pdf_sections;
$$;
create function public.club_catalog_order() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform club_require_staff('catalogo');
 return jsonb_build_object('revision',(select revision from club_catalog_order_state where id), 'rows',coalesce((select jsonb_agg(to_jsonb(x)-'sort_position'-'pdf_position' order by sort_position,pdf_position,name,code,id) from(
 select p.id,c.display_name as name,p.codice_mexal as code,c.visible,coalesce(c.display_position,r.rank,990000) as sort_position,coalesce(r.rank,990000) as pdf_position,coalesce(r.label,'Altri prodotti') as section
 from prodotti p join club_catalog_products c on c.product_id=p.id left join lateral(select s.position*1000+i.position as rank,concat_ws(' · ',parent.name,s.name) as label from club_catalog_pdf_items i join club_catalog_pdf_sections s on s.id=i.section_id left join club_catalog_pdf_sections parent on parent.id=s.parent_id where i.code=upper(btrim(p.codice_mexal)) order by s.position,i.position limit 1) r on true where club_catalog_eligible(p))x),'[]'));
end $$;
create function public.club_set_catalog_order(product_ids uuid[],expected_revision integer,reset_to_pdf boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare current_revision integer;catalog_audit_id uuid;begin
 perform club_require_staff('catalogo','scrittura');
 select revision,audit_id into current_revision,catalog_audit_id from club_catalog_order_state where id for update;
 if expected_revision is null or expected_revision<>current_revision then raise exception 'L’ordine è cambiato. Chiudi e riapri prima di salvare.' using errcode='40001';end if;
 if reset_to_pdf then update club_catalog_products set display_position=null;
 else
 if product_ids is null or cardinality(product_ids)>5000 or cardinality(product_ids)<>(select count(distinct x) from unnest(product_ids)x)
 or exists(select 1 from unnest(product_ids)x where not exists(select 1 from prodotti p join club_catalog_products c on c.product_id=p.id where p.id=x and club_catalog_eligible(p)))
 or exists(select 1 from prodotti p join club_catalog_products c on c.product_id=p.id where club_catalog_eligible(p) and not p.id=any(product_ids)) then raise exception 'L’elenco prodotti è cambiato o incompleto. Chiudi e riapri prima di salvare.';end if;
 update club_catalog_products c set display_position=x.pos from unnest(product_ids) with ordinality x(product_id,pos) where c.product_id=x.product_id;
 end if;
 update club_catalog_order_state set revision=revision+1 where id;
 perform club_audit_event(case when reset_to_pdf then 'CATALOG_ORDER_RESET' else 'CATALOG_ORDER_UPDATED' end,catalog_audit_id,jsonb_build_object('revision',current_revision+1,'count',cardinality(product_ids)));
end $$;
do $$declare f record;begin
 for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('club_workspace_document_matches','club_product_materials','club_catalog_query','club_browse_catalog','club_pdf_sections','club_catalog_order','club_set_catalog_order') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.proname in('club_browse_catalog','club_pdf_sections') then execute format('grant execute on function %s to anon,authenticated',f.signature);
 elsif f.proname in('club_catalog_order','club_set_catalog_order') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
do $$declare original text;revised text;begin
 select pg_get_functiondef('public.club_api_boundary()'::regprocedure) into original;
 revised:=replace(original,'''/rpc/club_catalog_products''','''/rpc/club_catalog_products'',''/rpc/club_browse_catalog'',''/rpc/club_pdf_sections''');
 if revised=original then raise exception 'Unexpected Club API boundary.';end if;execute revised;
end $$;
notify pgrst,'reload schema';
commit;

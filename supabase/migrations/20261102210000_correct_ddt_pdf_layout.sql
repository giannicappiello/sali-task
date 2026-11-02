begin;
create table public.warehouse_preparation_document_revisions(
 id bigint generated always as identity primary key,preparation_id uuid not null references public.warehouse_order_preparations(id),
 kind text not null check(kind in('bcf','bcf_print','packing_list') or kind ~ '^packing_pallet_[a-f0-9-]{36}$'),filename text not null,sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 base64 text not null check(length(base64)>0 and length(base64)<=14000000),snapshot jsonb not null,
 actor uuid not null references public.utenti(id),created_at timestamptz not null default clock_timestamp(),unique(preparation_id,kind,sha256)
);
alter table public.warehouse_preparation_document_revisions enable row level security;
revoke all on public.warehouse_preparation_document_revisions from public,anon,authenticated,service_role;
grant select on public.warehouse_preparation_document_revisions to service_role;
create trigger warehouse_ddt_revisions_immutable before update or delete or truncate on public.warehouse_preparation_document_revisions for each statement execute function public.warehouse_immutable_history();
create view public.warehouse_current_preparation_documents with(security_invoker=true) as
 select distinct on(preparation_id,kind) preparation_id,kind,filename,sha256,base64,snapshot,created_at from (
  select preparation_id,kind,filename,sha256,base64,snapshot,created_at,0::bigint revision from public.warehouse_preparation_documents
  union all select preparation_id,kind,filename,sha256,base64,snapshot,created_at,id revision from public.warehouse_preparation_document_revisions
 ) versions order by preparation_id,kind,revision desc;
revoke all on public.warehouse_current_preparation_documents from public,anon,authenticated;
grant select on public.warehouse_current_preparation_documents to service_role;
create function public.warehouse_correct_ddt_pdf(p_id uuid,p_actor uuid,p_expected text,p_files jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.warehouse_order_preparations;original public.warehouse_preparation_documents;f jsonb;
begin
 select * into strict r from public.warehouse_order_preparations where id=p_id for update;
 if r.status<>'completed' or r.ddt->>'signature'<>'BCF' or not exists(select 1 from public.utenti where id=p_actor and attivo is not false) then raise exception 'Bolla o operatore non validi';end if;
 if exists(select 1 from public.warehouse_preparation_document_revisions where preparation_id=p_id and kind='bcf') then return '{"alreadyCorrected":true}'::jsonb;end if;
 select * into strict original from public.warehouse_preparation_documents where preparation_id=p_id and kind='bcf';
 if original.sha256 is distinct from p_expected then raise exception 'PDF originale cambiato' using errcode='40001';end if;
 if exists(select 1 from public.warehouse_print_jobs where preparation_id=p_id and document_kind='bcf_print' and status in('queued','leased','printing','uncertain')) then raise exception 'Attendere la verifica della stampa precedente prima di correggere il PDF';end if;
 if jsonb_array_length(p_files)<>2 or (select count(distinct value->>'kind') from jsonb_array_elements(p_files) where value->>'kind' in('bcf','bcf_print'))<>2 then raise exception 'PDF correttivi incompleti';end if;
 for f in select value from jsonb_array_elements(p_files) loop
  if substring(decode(f->>'base64','base64') from 1 for 5)<>convert_to('%PDF-','UTF8') then raise exception 'PDF correttivo non valido';end if;
  insert into public.warehouse_preparation_document_revisions(preparation_id,kind,filename,sha256,base64,snapshot,actor)
  values(p_id,f->>'kind',f->>'filename',f->>'sha256',f->>'base64',original.snapshot||jsonb_build_object('pdfPrintModule','S','reason','Esclusa Stampa Indirizzo; recuperato il DDT reale','originalSha256',original.sha256),p_actor);
 end loop;
 insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload) values(p_id,gen_random_uuid(),'ddt_pdf_corrected',p_actor,jsonb_build_object('reason','Esclusa Stampa Indirizzo; documento Mexal invariato','originalSha256',original.sha256,'printModule','S','documents',(select jsonb_agg(value-'base64') from jsonb_array_elements(p_files))));
 return '{"corrected":true}'::jsonb;
end;$$;
revoke all on function public.warehouse_correct_ddt_pdf(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.warehouse_correct_ddt_pdf(uuid,uuid,text,jsonb) to service_role;
create function public.warehouse_correct_packing_pdf(p_id uuid,p_actor uuid,p_files jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.warehouse_order_preparations;original public.warehouse_preparation_documents;f jsonb;
begin
 select * into strict r from public.warehouse_order_preparations where id=p_id for update;
 if r.status<>'completed' or not exists(select 1 from public.utenti where id=p_actor and attivo is not false) then raise exception 'Ordine o operatore non validi';end if;
 if exists(select 1 from public.warehouse_preparation_document_revisions where preparation_id=p_id and kind='packing_list') then return '{"alreadyCorrected":true}'::jsonb;end if;
 if exists(select 1 from public.warehouse_print_jobs where preparation_id=p_id and document_kind like 'packing_pallet_%' and status in('queued','leased','printing','uncertain')) then raise exception 'Attendere la verifica della stampa packing precedente';end if;
 if jsonb_array_length(p_files)<>1+jsonb_array_length(r.state->'pallets') or not exists(select 1 from jsonb_array_elements(p_files) where value->>'kind'='packing_list') or exists(select 1 from jsonb_array_elements(r.state->'pallets') p where not exists(select 1 from jsonb_array_elements(p_files) file_entry where file_entry->>'kind'='packing_pallet_'||(p->>'id'))) then raise exception 'Packing list correttive incomplete';end if;
 for f in select value from jsonb_array_elements(p_files) loop
  select * into strict original from public.warehouse_preparation_documents where preparation_id=p_id and kind=f->>'kind';
  if f->>'kind' in('bcf','bcf_print') or substring(decode(f->>'base64','base64') from 1 for 5)<>convert_to('%PDF-','UTF8') then raise exception 'Packing list non valida';end if;
  insert into public.warehouse_preparation_document_revisions(preparation_id,kind,filename,sha256,base64,snapshot,actor) values(p_id,f->>'kind',f->>'filename',f->>'sha256',f->>'base64',original.snapshot||jsonb_build_object('packingLayout','compact-v2','originalSha256',original.sha256),p_actor);
 end loop;
 insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload) values(p_id,gen_random_uuid(),'packing_pdf_compacted',p_actor,jsonb_build_object('reason','Packing list compatta; titoli una sola volta per pagina','documents',(select jsonb_agg(value-'base64') from jsonb_array_elements(p_files))));
 return '{"corrected":true}'::jsonb;
end;$$;
revoke all on function public.warehouse_correct_packing_pdf(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.warehouse_correct_packing_pdf(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

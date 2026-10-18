begin;
-- The Club reads media from the Workspace library; only missing catalogue
-- entries and unambiguous technical-sheet links need reconciliation.
create function public.club_sync_workspace_catalog() returns jsonb
language plpgsql security definer set search_path=public as $$
declare added integer; linked integer; result jsonb; sync_id uuid:=gen_random_uuid();
begin
 perform public.club_require_staff('catalogo','scrittura');
 if not pg_try_advisory_xact_lock(hashtext('club_sync_workspace_catalog')) then
  raise exception 'Sincronizzazione già in corso. Riprova tra poco.' using errcode='55P03';
 end if;
 insert into public.club_catalog_products(product_id,display_name,description)
 select p.id,p.nome,'' from public.prodotti p where public.club_catalog_eligible(p)
 on conflict(product_id) do nothing;
 get diagnostics added=row_count;
 with exact_skus as materialized (
  select upper(btrim(p.codice_mexal)) code,min(p.id::text)::uuid product_id,min(p.nome) name
  from public.prodotti p where public.club_catalog_eligible(p)
  group by upper(btrim(p.codice_mexal)) having count(*)=1
 )
 update public.documenti_workspace d set prodotto_id=p.product_id,prodotto=p.name,aggiornato_il=clock_timestamp()
 from exact_skus p,public.sezioni_documentali s
 where d.sezione_id=s.id and lower(btrim(s.nome))='schede tecniche' and s.attiva and d.attivo and d.prodotto_id is null
 and upper(btrim(regexp_replace(d.nome_file,'\.[^.]+$','')))=p.code;
 get diagnostics linked=row_count;
 update public.club_catalog_products c set updated_at=clock_timestamp()
 from public.prodotti p where c.product_id=p.id and public.club_catalog_eligible(p);
 select jsonb_build_object('added_products',added,'linked_documents',linked,
  'products',(select count(*) from public.club_catalog_products c join public.prodotti p on p.id=c.product_id where c.visible and public.club_catalog_eligible(p)),
  'documents',count(distinct d.id),
  'images',count(distinct d.id) filter(where d.mime_group='immagine'),
  'sync_id',sync_id,'synced_at',clock_timestamp()) into result
 from public.club_catalog_products c join public.prodotti p on p.id=c.product_id
 join public.documenti_workspace d on d.attivo and (
  public.club_workspace_document_matches(d,p) or exists(select 1 from public.club_catalog_product_media m where m.product_id=p.id and m.document_id=d.id)
 ) where c.visible and public.club_catalog_eligible(p);
 perform public.club_audit_event('WORKSPACE_CATALOG_SYNCED',sync_id,result);
 return result;
end $$;
revoke all on function public.club_sync_workspace_catalog() from public,anon;
grant execute on function public.club_sync_workspace_catalog() to authenticated;
notify pgrst,'reload schema';
commit;
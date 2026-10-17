begin;

-- The Club recognizes existing Workspace administrators without enrolling them
-- as members or weakening the isolation of external Club identities.
create or replace function public.club_session() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare identity uuid;profile public.utenti;begin
 if public.workspace_internal_user() and not public.club_external_identity() then
  select u.* into profile from public.utenti u join public.ruoli r on r.id=u.ruolo_id
  where u.auth_user_id=auth.uid() and u.attivo is not false and r.amministratore_workspace;
  if found then
   perform public.club_require_staff('dashboard');
   return jsonb_build_object('role','admin','name',concat_ws(' ',profile.nome,profile.cognome));
  end if;
 end if;
 identity:=public.club_verified_identity();
 return jsonb_build_object('role',case when exists(select 1 from public.club_store_users where auth_user_id=identity and active) then 'store' when exists(select 1 from public.club_members where auth_user_id=identity and active) then 'member' else 'onboarding' end,'store_code',public.club_store_code());
end $$;

create function public.club_admin_purchases(search_text text default '',page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.club_require_staff('clienti');
 if page_offset<0 or length(search_text)>200 then raise exception 'Parametri elenco non validi.';end if;
 return (with filtered as materialized (
  select p.id,p.member_id,p.amount,p.cashback,p.status,p.created_at,p.reversal_reason,a.nome as customer_name,m.member_code,c.ragione_sociale as store_name,
  (select jsonb_agg(jsonb_build_object('name',coalesce(i.product_name,pr.nome),'quantity',i.quantity,'amount',i.amount)) from public.club_purchase_items i join public.prodotti pr on pr.id=i.product_id where i.purchase_id=p.id) as items
  from public.club_purchases p join public.club_members m on m.id=p.member_id join public.crm_accounts a on a.id=m.crm_account_id join public.ordini_clienti_cache c on c.codice_cliente=p.store_code
  where coalesce(search_text,'')='' or concat_ws(' ',a.nome,m.member_code,c.ragione_sociale,p.id::text) ilike '%'||search_text||'%'
 ) select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(v)) from(select * from filtered order by created_at desc,id limit 25 offset page_offset)v),'[]')));
end $$;
revoke all on function public.club_admin_purchases(text,integer) from public,anon,authenticated;
grant execute on function public.club_admin_purchases(text,integer) to authenticated;
notify pgrst,'reload schema';
commit;

begin;

-- Reuse Workspace's current assignment, beauty association, team, department
-- and hierarchy rules. No parallel agent/beauty lists or new role grants.
create function public.club_staff_store_codes() returns setof text language sql stable security definer set search_path=public as $$
 select code from public.crm_visible_canonical_customer_codes() code
 where public.workspace_internal_user() and not public.club_external_identity()
 and public.crm_has_module_level('crm_online','lettura');
$$;
create function public.club_staff_member_ids() returns setof uuid language sql stable security definer set search_path=public as $$
 with stores as materialized(select public.club_staff_store_codes() as code)
 select m.id from public.club_members m join public.crm_accounts a on a.id=m.crm_account_id
 where public.workspace_internal_user() and not public.club_external_identity() and
 (public.crm_row_visible(a.responsabile_id,a.reparto_id,'crm_online') or m.trusted_store_code in(select code from stores));
$$;
revoke all on function public.club_staff_store_codes(),public.club_staff_member_ids() from public,anon,authenticated;

create view public.club_scoped_members as select * from public.club_members where id in(select public.club_staff_member_ids());
create view public.club_scoped_customer_directory as select * from public.ordini_clienti_cache where codice_cliente in(select public.club_staff_store_codes());
create view public.club_scoped_requests as select * from public.club_requests where member_id in(select public.club_staff_member_ids()) and (store_code is null or store_code in(select public.club_staff_store_codes()));
create view public.club_scoped_purchases as select * from public.club_purchases where member_id in(select public.club_staff_member_ids()) and store_code in(select public.club_staff_store_codes());
create view public.club_scoped_wallet as select * from public.club_wallet_movements where member_id in(select public.club_staff_member_ids());
create view public.club_scoped_store_users as select * from public.club_store_users where store_code in(select public.club_staff_store_codes());
revoke all on public.club_scoped_members,public.club_scoped_customer_directory,public.club_scoped_requests,public.club_scoped_purchases,public.club_scoped_wallet,public.club_scoped_store_users from public,anon,authenticated;

-- These server RPCs are shared by Workspace CRM and the public Club staff UI.
-- Retain their existing signatures and screen/write permissions.
do $scope$declare signature text;original text;revised text;begin
 foreach signature in array array[
 'public.club_admin_dashboard(date,date)','public.club_admin_requests(text,text,integer,integer)',
 'public.club_admin_members(text,integer,integer)','public.club_admin_movements(uuid,integer)',
 'public.club_admin_purchases(text,integer)','public.club_admin_stores()'] loop
  original:=pg_get_functiondef(signature::regprocedure);
  revised:=replace(replace(replace(replace(replace(replace(original,
   'public.club_members','public.club_scoped_members'),
   'public.club_requests','public.club_scoped_requests'),
   'public.club_purchases','public.club_scoped_purchases'),
   'public.club_wallet_movements','public.club_scoped_wallet'),
   'public.ordini_clienti_cache','public.club_scoped_customer_directory'),
   'public.club_store_users','public.club_scoped_store_users');
  if revised=original then raise exception 'Unexpected Club scope definition: %',signature;end if;
  execute revised;
 end loop;
end $scope$;

-- A guessed ID must not bypass scope, including mutation endpoints.
alter function public.club_transition_request(uuid,text,text) rename to club_transition_request_scope_impl;
revoke all on function public.club_transition_request_scope_impl(uuid,text,text) from public,anon,authenticated;
create function public.club_transition_request(target_id uuid,target_status text,reference text default '') returns jsonb language plpgsql security definer set search_path=public as $$
begin
 perform public.club_require_staff('richieste','scrittura');
 if not exists(select 1 from public.club_scoped_requests where id=target_id) then raise exception 'Richiesta non disponibile nel tuo ambito Workspace.' using errcode='42501';end if;
 return public.club_transition_request_scope_impl(target_id,target_status,reference);
end $$;
alter function public.club_admin_enable_store(text,boolean) rename to club_admin_enable_store_scope_impl;
revoke all on function public.club_admin_enable_store_scope_impl(text,boolean) from public,anon,authenticated;
create function public.club_admin_enable_store(target_store_code text,is_enabled boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 perform public.club_require_staff('negozi','scrittura');
 if target_store_code not in(select public.club_staff_store_codes()) or target_store_code is null then raise exception 'Negozio non disponibile nel tuo ambito Workspace.' using errcode='42501';end if;
 perform public.club_admin_enable_store_scope_impl(target_store_code,is_enabled);
end $$;
alter function public.club_admin_invite_store(text,text) rename to club_admin_invite_store_scope_impl;
revoke all on function public.club_admin_invite_store_scope_impl(text,text) from public,anon,authenticated;
create function public.club_admin_invite_store(target_store_code text,email_address text) returns text language plpgsql security definer set search_path=public as $$
begin
 perform public.club_require_staff('negozi','scrittura');
 if target_store_code not in(select public.club_staff_store_codes()) or target_store_code is null then raise exception 'Negozio non disponibile nel tuo ambito Workspace.' using errcode='42501';end if;
 return public.club_admin_invite_store_scope_impl(target_store_code,email_address);
end $$;
alter function public.club_admin_operator(uuid,boolean) rename to club_admin_operator_scope_impl;
revoke all on function public.club_admin_operator_scope_impl(uuid,boolean) from public,anon,authenticated;
create function public.club_admin_operator(target_auth_id uuid,is_active boolean) returns void language plpgsql security definer set search_path=public as $$
begin
 perform public.club_require_staff('negozi','scrittura');
 if not exists(select 1 from public.club_scoped_store_users where auth_user_id=target_auth_id) then raise exception 'Operatore non disponibile nel tuo ambito Workspace.' using errcode='42501';end if;
 perform public.club_admin_operator_scope_impl(target_auth_id,is_active);
end $$;
revoke all on function public.club_transition_request(uuid,text,text),public.club_admin_enable_store(text,boolean),public.club_admin_invite_store(text,text),public.club_admin_operator(uuid,boolean) from public,anon,authenticated;
grant execute on function public.club_transition_request(uuid,text,text),public.club_admin_enable_store(text,boolean),public.club_admin_invite_store(text,text),public.club_admin_operator(uuid,boolean) to authenticated;

create or replace function public.club_session() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare identity uuid;profile public.utenti;role_name text;is_admin boolean;permissions jsonb;begin
 if public.workspace_internal_user() and not public.club_external_identity() then
  select u.* into profile from public.utenti u where u.auth_user_id=auth.uid() and u.attivo is not false;
  select r.nome,r.amministratore_workspace into role_name,is_admin from public.ruoli r where r.id=profile.ruolo_id;
  select jsonb_object_agg(code,case when public.club_staff_allowed(code,'amministrazione') then 'amministrazione' when public.club_staff_allowed(code,'scrittura') then 'scrittura' when public.club_staff_allowed(code) then 'lettura' else 'nessuno' end) into permissions
  from unnest(array['dashboard','clienti','richieste','negozi','premi','configurazione','regolamento'])code;
  if not exists(select 1 from jsonb_each_text(permissions) p where p.value<>'nessuno') then raise exception 'Il tuo ruolo Workspace non ha accesso alle schermate SalidischiaClub. Verifica i permessi CRM BtoC del ruolo.' using errcode='42501';end if;
  return jsonb_build_object('role',case when is_admin then 'admin' else 'staff' end,'workspace_role',role_name,'name',concat_ws(' ',profile.nome,profile.cognome),'permissions',permissions);
 end if;
 identity:=public.club_verified_identity();
 return jsonb_build_object('role',case when exists(select 1 from public.club_store_users where auth_user_id=identity and active) then 'store' when exists(select 1 from public.club_members where auth_user_id=identity and active) then 'member' else 'onboarding' end,'store_code',public.club_store_code());
end $$;
notify pgrst,'reload schema';
commit;

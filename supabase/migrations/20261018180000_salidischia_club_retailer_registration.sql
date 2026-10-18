begin;
alter table public.club_stores add column display_name text check(length(display_name) between 1 and 120);
create table public.club_retailer_registrations (
 id uuid primary key default gen_random_uuid(),token_hash text not null unique,store_code text not null references public.ordini_clienti_cache(codice_cliente),email text not null,
 auth_user_id uuid unique references auth.users(id),shop_name text,expires_at timestamptz not null default now()+interval '20 minutes',completed_at timestamptz,created_at timestamptz not null default now()
);
create table public.club_store_profiles (
 auth_user_id uuid primary key references auth.users(id),store_code text not null references public.club_stores(store_code),first_name text not null,last_name text not null,email text not null,phone text,completed_at timestamptz not null default now()
);
create table public.club_store_consents (
 id uuid primary key default gen_random_uuid(),auth_user_id uuid not null references auth.users(id),purpose text not null check(purpose in('program','profiling')),granted boolean not null,document_url text not null,captured_at timestamptz not null default now()
);
create table public.club_registration_limits(bucket text primary key,started_at timestamptz not null default now(),requests integer not null default 1);
do $$declare t text;begin foreach t in array array['club_retailer_registrations','club_store_profiles','club_store_consents','club_registration_limits'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
create function public.club_registration_limit(bucket_key text,max_requests integer,window_seconds integer) returns boolean language plpgsql security definer set search_path=public as $$
declare amount integer;begin
 if length(bucket_key)>150 or max_requests not between 1 and 200 or window_seconds not between 60 and 86400 then raise exception 'Limite non valido.';end if;
 insert into club_registration_limits(bucket)values(bucket_key) on conflict(bucket)do update set
 requests=case when club_registration_limits.started_at<now()-make_interval(secs=>window_seconds) then 1 else club_registration_limits.requests+1 end,
 started_at=case when club_registration_limits.started_at<now()-make_interval(secs=>window_seconds) then now() else club_registration_limits.started_at end returning requests into amount;
 return amount<=max_requests;
end $$;
create function public.club_retailer_customer(target_store text) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('store_code',c.codice_cliente,'legal_name',c.ragione_sociale,'email',btrim(split_part(replace(coalesce(c.email,''),';',','),',',1)))
 from ordini_clienti_cache c join crm_customer_classifications k on k.codice_cliente=c.codice_cliente and k.area_crm='b2b'
 left join club_stores s on s.store_code=c.codice_cliente
 where c.codice_cliente=target_store and c.attivo_mexal is not false and coalesce(s.enabled,true)
 and not exists(select 1 from crm_customer_status st where st.customer_key='mexal:'||c.codice_cliente and not st.crm_active);
$$;
create function public.club_retailer_lookup(vat_number text,challenge_hash text) returns jsonb language plpgsql security definer set search_path=public as $$
declare vat text;codes text[];customer jsonb;registration_id uuid;begin
 if not coalesce((club_public_info()->>'registration_available')::boolean,false) then raise exception 'Le iscrizioni al Club non sono ancora aperte.';end if;
 vat:=regexp_replace(upper(coalesce(vat_number,'')),'[^A-Z0-9]','','g');vat:=regexp_replace(vat,'^IT','');
 if vat !~ '^[0-9]{11}$' or challenge_hash !~ '^[a-f0-9]{64}$' then raise exception 'Inserisci una partita IVA italiana di 11 cifre.';end if;
 select array_agg(c.codice_cliente) into codes from ordini_clienti_cache c
 where regexp_replace(regexp_replace(upper(coalesce(c.partita_iva,'')),'[^A-Z0-9]','','g'),'^IT','')=vat and club_retailer_customer(c.codice_cliente) is not null;
 if coalesce(cardinality(codes),0)<>1 then raise exception 'Partita IVA non riconosciuta in modo univoco tra i rivenditori attivi. Contatta il backoffice.';end if;
 customer:=club_retailer_customer(codes[1]);
 if coalesce(customer->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Per questa anagrafica manca un’email valida. Contatta il backoffice per aggiornarla.';end if;
 insert into club_retailer_registrations(token_hash,store_code,email)values(challenge_hash,codes[1],customer->>'email')returning id into registration_id;
 return customer||jsonb_build_object('registration_id',registration_id);
end $$;
create function public.club_retailer_challenge(challenge_hash text) returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('registration_id',r.id,'email',r.email,'legal_name',c.ragione_sociale)
 from club_retailer_registrations r join ordini_clienti_cache c on c.codice_cliente=r.store_code
 where r.token_hash=challenge_hash and r.expires_at>now() and r.auth_user_id is null and club_retailer_customer(r.store_code)->>'email'=r.email;
$$;
create function public.club_bind_retailer_registration(registration_id uuid,identity_id uuid,shop_name text) returns void language plpgsql security definer set search_path=public as $$
declare registration club_retailer_registrations;requested_name text:=shop_name;begin
 select * into registration from club_retailer_registrations r where r.id=registration_id and r.expires_at>now() for update;
 if not found or length(coalesce(shop_name,''))>120 or registration.auth_user_id is not null then raise exception 'Registrazione scaduta. Riparti dalla partita IVA.';end if;
 if not exists(select 1 from auth.users u where u.id=identity_id and lower(u.email)=lower(registration.email) and coalesce((u.raw_app_meta_data->>'club_only')::boolean,false))
 or exists(select 1 from club_members where auth_user_id=identity_id) or exists(select 1 from club_store_users where auth_user_id=identity_id) then raise exception 'Usa Accedi o recupera la password dell’account già presente.';end if;
 update club_retailer_registrations r set auth_user_id=identity_id,shop_name=nullif(btrim(requested_name),''),expires_at=now()+interval '7 days' where r.id=registration_id;
end $$;
alter function public.club_enrollment_identity() rename to club_enrollment_identity_base;
revoke all on function public.club_enrollment_identity_base() from public,anon,authenticated;
create function public.club_enrollment_identity(invitation_token text default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare identity uuid;result jsonb;registration club_retailer_registrations;invitation club_store_invitations;begin
 identity:=club_verified_identity();result:=club_enrollment_identity_base();
 if nullif(invitation_token,'') is not null then
  select * into invitation from club_store_invitations i where i.token_hash=encode(sha256(convert_to(invitation_token,'UTF8')),'hex') and i.expires_at>now() and (i.claimed_by is null or i.claimed_by=identity) and lower(i.email)=lower(result->>'email');
  if not found then raise exception 'Invito non valido per questa email.';end if;
  return result||jsonb_build_object('kind','store','legal_name',(select ragione_sociale from ordini_clienti_cache where codice_cliente=invitation.store_code),'shop_name',(select display_name from club_stores where store_code=invitation.store_code));
 end if;
 select * into registration from club_retailer_registrations r where r.auth_user_id=identity and r.completed_at is null and r.expires_at>now();
 if found then return result||jsonb_build_object('kind','store','legal_name',(select ragione_sociale from ordini_clienti_cache where codice_cliente=registration.store_code),'shop_name',registration.shop_name);end if;
 if exists(select 1 from club_retailer_registrations where auth_user_id=identity) then raise exception 'Registrazione del negozio scaduta. Contatta il backoffice.';end if;
 return result||jsonb_build_object('kind','consumer');
end $$;
create function public.club_enroll_retailer(first_name text,last_name text,email_address text,phone_number text,accept_program boolean,profiling boolean,expected_terms_url text,expected_privacy_url text,shop_name text default '',invitation_token text default null)
returns text language plpgsql security definer set search_path=public as $$
declare identity uuid;details jsonb;registration club_retailer_registrations;store text;settings club_public_settings;begin
 identity:=club_verified_identity();perform pg_advisory_xact_lock(hashtext(identity::text));
 store:=club_store_code();if store is not null and exists(select 1 from club_store_profiles where auth_user_id=identity) then return store;end if;
 details:=club_enrollment_identity(invitation_token);
 if details->>'kind'<>'store' or exists(select 1 from club_members where auth_user_id=identity) then raise exception 'Registrazione negozio non disponibile.';end if;
 if length(btrim(coalesce(first_name,''))) not between 1 and 100 or length(btrim(coalesce(last_name,''))) not between 1 and 100 or length(coalesce(phone_number,''))>30 or length(coalesce(shop_name,''))>120 then raise exception 'Controlla nome, cognome, telefono e nome negozio.';end if;
 if email_address is null or lower(btrim(email_address)) is distinct from lower(details->>'email') then raise exception 'Usa l’email verificata del negozio.';end if;
 select * into settings from club_public_settings where id;
 if settings.terms_url is null or settings.privacy_url is null or settings.terms_url is distinct from expected_terms_url or settings.privacy_url is distinct from expected_privacy_url then raise exception 'I documenti del Club sono cambiati. Ricarica prima di proseguire.';end if;
 if accept_program is distinct from true or profiling is distinct from true then raise exception 'Completa l’accettazione del programma e il consenso alla profilazione.';end if;
 if nullif(invitation_token,'') is not null then store:=club_claim_store_invite(invitation_token);
 else
  select * into registration from club_retailer_registrations r where r.auth_user_id=identity and r.completed_at is null and r.expires_at>now() for update;
  if not found or lower(club_retailer_customer(registration.store_code)->>'email') is distinct from lower(email_address) then raise exception 'Anagrafica non più abilitata. Contatta il backoffice.';end if;
  store:=registration.store_code;
  insert into club_stores(store_code)values(store) on conflict(store_code)do nothing;
  insert into club_store_users(auth_user_id,store_code)values(identity,store) on conflict(auth_user_id)do nothing;
  update club_retailer_registrations set completed_at=now() where id=registration.id;
 end if;
 update club_stores set display_name=coalesce(nullif(btrim(shop_name),''),display_name),updated_at=clock_timestamp() where store_code=store;
 insert into club_store_profiles(auth_user_id,store_code,first_name,last_name,email,phone)values(identity,store,btrim(first_name),btrim(last_name),details->>'email',nullif(btrim(phone_number),'')) on conflict(auth_user_id)do nothing;
 insert into club_store_consents(auth_user_id,purpose,granted,document_url)values(identity,'program',true,settings.terms_url),(identity,'profiling',true,settings.privacy_url);
 perform club_audit_event('RETAILER_ENROLLED',identity,jsonb_build_object('store_code',store));return store;
end $$;
-- Prevent a pending retailer from completing the consumer route instead.
alter function public.club_enroll_member(text,text,text,text,boolean,boolean,text,text) rename to club_enroll_consumer_impl;
revoke all on function public.club_enroll_consumer_impl(text,text,text,text,boolean,boolean,text,text) from public,anon,authenticated;
create function public.club_enroll_member(first_name text,last_name text,email_address text,phone_number text,accept_program boolean,profiling boolean,expected_terms_url text,expected_privacy_url text) returns uuid language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from club_retailer_registrations where auth_user_id=auth.uid()) then raise exception 'Completa l’iscrizione come rivenditore.';end if;
 return club_enroll_consumer_impl(first_name,last_name,email_address,phone_number,accept_program,profiling,expected_terms_url,expected_privacy_url);
end $$;
create or replace function public.club_list_stores(search_text text default '',page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform club_verified_identity();if page_offset<0 or length(search_text)>100 then raise exception 'Ricerca non valida.';end if;
 return(with stores as materialized(select c.codice_cliente as store_code,coalesce(s.display_name,c.ragione_sociale) as name,c.ragione_sociale as legal_name,c.indirizzo as address,c.provincia as province,c.cap as postal_code from club_stores s join ordini_clienti_cache c on c.codice_cliente=s.store_code where s.enabled and c.attivo_mexal is not false and concat_ws(' ',s.display_name,c.ragione_sociale,c.indirizzo,c.provincia,c.cap) ilike '%'||coalesce(search_text,'')||'%') select jsonb_build_object('total',(select count(*) from stores),'rows',coalesce((select jsonb_agg(to_jsonb(x) order by name,store_code)from(select * from stores order by name,store_code limit 25 offset page_offset)x),'[]')));
end $$;
alter function public.club_member_portal() rename to club_member_portal_registration_base;
revoke all on function public.club_member_portal_registration_base() from public,anon,authenticated;
create function public.club_member_portal() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;shop text;begin
 result:=club_member_portal_registration_base();select display_name into shop from club_stores where store_code=result#>>'{member,store_code}';
 if shop is not null then result:=jsonb_set(result,'{member,store_name}',to_jsonb(shop));end if;return result;
end $$;
revoke all on function public.club_member_portal() from public,anon,authenticated;
grant execute on function public.club_member_portal() to authenticated;
do $$declare f record;begin
 for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('club_registration_limit','club_retailer_customer','club_retailer_lookup','club_retailer_challenge','club_bind_retailer_registration','club_enrollment_identity','club_enroll_retailer','club_enroll_member') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.proname in('club_enrollment_identity','club_enroll_retailer','club_enroll_member') then execute format('grant execute on function %s to authenticated',f.signature);else execute format('grant execute on function %s to service_role',f.signature);end if;end loop;
end $$;
revoke all on function public.club_claim_store_invite(text) from public,anon,authenticated;
do $$declare original text;revised text;begin
 select pg_get_functiondef('public.club_api_boundary()'::regprocedure) into original;
 revised:=replace(original,'''/rpc/club_enroll_member''','''/rpc/club_enroll_member'',''/rpc/club_enroll_retailer''');
 if revised=original then raise exception 'Unexpected Club API boundary.';end if;execute revised;
end $$;
notify pgrst,'reload schema';commit;

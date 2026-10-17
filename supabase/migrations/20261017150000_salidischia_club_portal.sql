begin;

create table public.club_public_settings (
 id boolean primary key default true check(id),
 crm_owner_id uuid references public.utenti(id),
 privacy_url text check(privacy_url is null or privacy_url ~ '^https://[^[:space:]]+$'),
 terms_url text check(terms_url is null or terms_url ~ '^https://[^[:space:]]+$'),
 support_email text not null default '',
 updated_at timestamptz not null default now()
);
insert into public.club_public_settings(id) values(true);
create table public.club_stores (
 store_code text primary key references public.ordini_clienti_cache(codice_cliente) on update cascade on delete restrict,
 enabled boolean not null default true,updated_at timestamptz not null default now()
);
create table public.club_store_users (
 auth_user_id uuid primary key references auth.users(id),store_code text not null references public.club_stores(store_code),
 active boolean not null default true,joined_at timestamptz not null default now()
);
create index club_store_users_store_idx on public.club_store_users(store_code);
create table public.club_store_invitations (
 id uuid primary key default gen_random_uuid(),store_code text not null references public.club_stores(store_code),
 email text not null,token_hash text not null unique,expires_at timestamptz not null default now()+interval '7 days',
 claimed_by uuid references auth.users(id),claimed_at timestamptz,created_at timestamptz not null default now()
);
create table public.club_member_store_history (
 id uuid primary key default gen_random_uuid(),member_id uuid not null references public.club_members(id),
 store_code text not null references public.club_stores(store_code),started_at timestamptz not null default now(),ended_at timestamptz
);
create unique index club_member_store_active_unique on public.club_member_store_history(member_id) where ended_at is null;
create table public.club_consents (
 id uuid primary key default gen_random_uuid(),member_id uuid not null references public.club_members(id),
 purpose text not null check(purpose in ('program','marketing','profiling')),granted boolean not null,
 document_url text not null,captured_at timestamptz not null default now()
);
alter table public.club_purchases add column recorded_by uuid references auth.users(id), add column reversed_by uuid references auth.users(id),add column reversal_reason text;
alter table public.club_purchase_items add column product_name text;
alter table public.club_requests add column pickup_code text not null default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));

do $$declare t text;begin
 foreach t in array array['club_public_settings','club_stores','club_store_users','club_store_invitations','club_member_store_history','club_consents'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

-- Club identities use their own session and never become Workspace operators.
create function public.club_classify_auth_identity() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.raw_user_meta_data->>'club_app'='salidischia-club' then
  if exists(select 1 from public.utenti where lower(email)=lower(new.email)) then raise exception 'Per il Club utilizza un indirizzo diverso dall’account Workspace.';end if;
  new.raw_app_meta_data:=coalesce(new.raw_app_meta_data,'{}')||'{"club_only":true}'::jsonb;
 end if;
 return new;
end $$;
create trigger club_classify_auth_identity before insert on auth.users for each row execute function public.club_classify_auth_identity();
do $$declare original text;revised text;begin
 select pg_get_functiondef('public.handle_new_auth_user()'::regprocedure) into original;
 revised:=regexp_replace(original,'\mBEGIN\M','BEGIN'||chr(10)||'  IF NEW.raw_app_meta_data->>''club_only'' = ''true'' THEN RETURN NEW; END IF;', 'i');
 if revised=original then raise exception 'Unexpected auth trigger: Club isolation not applied.';end if;
 execute revised;
end $$;
create function public.club_block_workspace_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from auth.users where id=new.auth_user_id and raw_app_meta_data->>'club_only'='true') then
  raise exception 'Gli account Club non possono accedere a Workspace.' using errcode='42501';
 end if;return new;
end $$;
create trigger club_block_workspace_profile before insert or update of auth_user_id on public.utenti for each row execute function public.club_block_workspace_profile();

create function public.club_verified_identity() returns uuid language plpgsql stable security definer set search_path=public as $$
declare identity uuid;begin
 select id into identity from auth.users where id=auth.uid() and email_confirmed_at is not null and raw_app_meta_data->>'club_only'='true';
 if identity is null then raise exception 'Accedi con un account Club e conferma il tuo indirizzo email.' using errcode='42501';end if;
 return identity;
end $$;
create function public.club_store_code() returns text language sql stable security definer set search_path=public as $$
 select u.store_code from public.club_store_users u join public.club_stores s on s.store_code=u.store_code
 join public.ordini_clienti_cache c on c.codice_cliente=s.store_code
 where u.auth_user_id=auth.uid() and u.active and s.enabled and c.attivo_mexal is not false;
$$;
create function public.club_public_info() returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('privacy_url',s.privacy_url,'terms_url',s.terms_url,'support_email',s.support_email,
 'registration_available',s.crm_owner_id is not null and s.privacy_url is not null and s.terms_url is not null,
 'program', (select jsonb_build_object('cashback_percent',cashback_percent,'reimbursement_modes',reimbursement_modes,'delivery_methods',delivery_methods,'cash_minimum',cash_minimum,'cash_method',cash_method,'shipping_fee',shipping_fee,'shipping_payment',shipping_payment,'free_shipping_threshold',free_shipping_threshold)
 from public.club_configurations where status='published' and effective_at<=now() order by effective_at desc,published_at desc,id limit 1)) from public.club_public_settings s where id;
$$;
create function public.club_session() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare identity uuid;begin
 identity:=public.club_verified_identity();
 return jsonb_build_object('role',case when exists(select 1 from public.club_store_users where auth_user_id=identity and active) then 'store' when exists(select 1 from public.club_members where auth_user_id=identity and active) then 'member' else 'onboarding' end,'store_code',public.club_store_code());
end $$;
create function public.club_enroll_member(display_name text,phone_number text,accept_program boolean,marketing boolean default false,profiling boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare identity uuid;settings public.club_public_settings;account_id uuid;member_id uuid;email_address text;matches integer;begin
 identity:=public.club_verified_identity();
 perform pg_advisory_xact_lock(hashtext(identity::text));
 if exists(select 1 from public.club_store_users where auth_user_id=identity) then raise exception 'Questo account è associato a un negozio.';end if;
 select id into member_id from public.club_members where auth_user_id=identity;
 if found then return member_id;end if;
 if accept_program is distinct from true or length(btrim(display_name)) not between 2 and 200 or length(phone_number)>30 then raise exception 'Controlla nome, telefono e accettazione del programma.';end if;
 select * into settings from public.club_public_settings where id;
 if settings.crm_owner_id is null or settings.privacy_url is null or settings.terms_url is null then raise exception 'Le iscrizioni al Club non sono ancora aperte.';end if;
 select email into email_address from auth.users where id=identity;
 select count(*),(array_agg(id))[1] into matches,account_id from public.crm_accounts where tipo='online' and lower(email)=lower(email_address);
 if matches>1 or exists(select 1 from public.club_members where crm_account_id=account_id) then raise exception 'La tua anagrafica richiede una verifica. Contatta l’assistenza Club.';end if;
 if matches=0 then
  insert into public.crm_accounts(tipo,nome,stato,fonte,email,telefono,responsabile_id,metadati)
  values('online',btrim(display_name),'attivo','SalidischiaClub',email_address,nullif(btrim(phone_number),''),settings.crm_owner_id,'{"channel":"club"}') returning id into account_id;
 end if;
 insert into public.club_members(auth_user_id,crm_account_id) values(identity,account_id) returning id into member_id;
 insert into public.club_consents(member_id,purpose,granted,document_url) values(member_id,'program',true,settings.terms_url),(member_id,'marketing',coalesce(marketing,false),settings.privacy_url),(member_id,'profiling',coalesce(profiling,false),settings.privacy_url);
 insert into public.crm_marketing_consents(account_id,purpose,status,legal_basis,source,captured_at,proof_reference,responsabile_id)
 values(account_id,'marketing',case when marketing then 'granted' else 'denied' end,'consent','SalidischiaClub',now(),settings.privacy_url,settings.crm_owner_id),
 (account_id,'profiling',case when profiling then 'granted' else 'denied' end,'consent','SalidischiaClub',now(),settings.privacy_url,settings.crm_owner_id);
 insert into public.crm_customer_events(account_id,fase,fonte,dati) values(account_id,'iscrizione','SalidischiaClub',jsonb_build_object('event','ACCOUNT_CREATED','member_id',member_id));
 perform public.club_audit_event('MEMBER_ENROLLED',member_id);
 return member_id;
end $$;

create function public.club_list_stores(search_text text default '',page_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.club_verified_identity();
 if page_offset<0 or length(search_text)>100 then raise exception 'Ricerca non valida.';end if;
 return (with stores as materialized (
  select c.codice_cliente as store_code,c.ragione_sociale as name,c.indirizzo as address,c.provincia as province,c.cap as postal_code
  from public.club_stores s join public.ordini_clienti_cache c on c.codice_cliente=s.store_code
  where s.enabled and c.attivo_mexal is not false and (coalesce(search_text,'')='' or concat_ws(' ',c.ragione_sociale,c.indirizzo,c.provincia,c.cap) ilike '%'||search_text||'%')
 ) select jsonb_build_object('total',(select count(*) from stores),'rows',coalesce((select jsonb_agg(to_jsonb(v)) from(select * from stores order by name,store_code limit 25 offset page_offset) v),'[]')));
end $$;
create function public.club_select_store(target_store_code text) returns void language plpgsql security definer set search_path=public as $$
declare member public.club_members;previous_code text;begin
 perform public.club_verified_identity();
 select * into member from public.club_members where auth_user_id=auth.uid() and active for update;
 if not found then raise exception 'Iscrizione non attiva.' using errcode='42501';end if;
 if not exists(select 1 from public.club_stores s join public.ordini_clienti_cache c on c.codice_cliente=s.store_code where s.store_code=target_store_code and s.enabled and c.attivo_mexal is not false) then raise exception 'Negozio non disponibile.';end if;
 if member.trusted_store_code is not distinct from target_store_code then return;end if;
 previous_code:=member.trusted_store_code;
 update public.club_member_store_history set ended_at=now() where member_id=member.id and ended_at is null;
 insert into public.club_member_store_history(member_id,store_code) values(member.id,target_store_code);
 update public.club_members set trusted_store_code=target_store_code where id=member.id;
 insert into public.crm_customer_events(account_id,fase,fonte,dati) values(member.crm_account_id,'loyalty','SalidischiaClub',jsonb_build_object('event',case when previous_code is null then 'STORE_SELECTED' else 'STORE_CHANGED' end,'store_code',target_store_code));
 perform public.club_audit_event('STORE_SELECTED',member.id,jsonb_build_object('previous',previous_code,'current',target_store_code));
end $$;

create function public.club_member_portal() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare member public.club_members;begin
 perform public.club_verified_identity();
 select * into member from public.club_members where auth_user_id=auth.uid() and active;
 if not found then raise exception 'Iscrizione non attiva.' using errcode='42501';end if;
 return jsonb_build_object('member',jsonb_build_object('id',member.id,'name',(select nome from public.crm_accounts where id=member.crm_account_id),'member_code',member.member_code,'joined_at',member.joined_at,'store_code',member.trusted_store_code,'store_name',(select ragione_sociale from public.ordini_clienti_cache where codice_cliente=member.trusted_store_code)),
 'wallet',(select jsonb_build_object('available',coalesce(sum(available_delta),0),'reserved',coalesce(sum(reserved_delta),0),'used',coalesce(-sum(reserved_delta) filter(where kind='spend'),0)) from public.club_wallet_movements where member_id=member.id),
 'public_info',public.club_public_info(),
 'rewards',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'description',r.description,'kind',r.kind,'budget_required',r.budget_required,'stock',r.stock,'delivery_methods',r.delivery_methods,'valid_until',r.valid_until) order by r.budget_required,r.name) from public.club_rewards r where r.active and r.stock>0 and (r.valid_until is null or r.valid_until>now()) and r.kind=any(coalesce((select reimbursement_modes from public.club_configurations where status='published' and effective_at<=now() order by effective_at desc,published_at desc,id limit 1),'{}'::text[]))),'[]'),
 'consents',coalesce((select jsonb_object_agg(purpose,granted) from(select distinct on(purpose) purpose,granted from public.club_consents where member_id=member.id order by purpose,captured_at desc,id) v),'{}'));
end $$;
create function public.club_member_history(history_kind text,page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare current_member_id uuid;begin
 perform public.club_verified_identity();
 select id into current_member_id from public.club_members where auth_user_id=auth.uid() and active;
 if current_member_id is null then raise exception 'Iscrizione non attiva.' using errcode='42501';end if;
 if page_offset<0 then raise exception 'Pagina non valida.';end if;
 if history_kind='requests' then
  return jsonb_build_object('total',(select count(*) from public.club_requests r where r.member_id=current_member_id),
  'rows',coalesce((select jsonb_agg(to_jsonb(v)) from(select r.id,r.reward_name,r.mode,r.amount,r.reserved_amount,r.shipping_fee,r.shipping_payment,r.delivery_method,r.status,r.created_at,r.completion_reference,r.pickup_code,c.ragione_sociale as store_name
   from public.club_requests r left join public.ordini_clienti_cache c on c.codice_cliente=r.store_code where r.member_id=current_member_id order by r.created_at desc,r.id limit 20 offset page_offset) v),'[]'));
 elsif history_kind='purchases' then
  return jsonb_build_object('total',(select count(*) from public.club_purchases p where p.member_id=current_member_id),
  'rows',coalesce((select jsonb_agg(to_jsonb(v)) from(select p.id,p.amount,p.cashback,p.status,p.created_at,c.ragione_sociale as store_name,
   (select jsonb_agg(jsonb_build_object('name',coalesce(i.product_name,pr.nome),'quantity',i.quantity,'amount',i.amount)) from public.club_purchase_items i join public.prodotti pr on pr.id=i.product_id where i.purchase_id=p.id) as items
   from public.club_purchases p join public.ordini_clienti_cache c on c.codice_cliente=p.store_code where p.member_id=current_member_id order by p.created_at desc,p.id limit 20 offset page_offset) v),'[]'));
 else raise exception 'Storico non valido.';end if;
end $$;
create function public.club_update_consents(marketing boolean,profiling boolean) returns void language plpgsql security definer set search_path=public as $$
declare member public.club_members;settings public.club_public_settings;begin
 perform public.club_verified_identity();select * into member from public.club_members where auth_user_id=auth.uid() and active for update;
 if not found then raise exception 'Iscrizione non attiva.' using errcode='42501';end if;
 select * into settings from public.club_public_settings where id;
 insert into public.club_consents(member_id,purpose,granted,document_url) values(member.id,'marketing',coalesce(marketing,false),settings.privacy_url),(member.id,'profiling',coalesce(profiling,false),settings.privacy_url);
 insert into public.crm_marketing_consents(account_id,purpose,status,legal_basis,source,captured_at,proof_reference,responsabile_id)
 values(member.crm_account_id,'marketing',case when marketing then 'granted' else 'withdrawn' end,'consent','SalidischiaClub',now(),settings.privacy_url,settings.crm_owner_id),
 (member.crm_account_id,'profiling',case when profiling then 'granted' else 'withdrawn' end,'consent','SalidischiaClub',now(),settings.privacy_url,settings.crm_owner_id);
 perform public.club_audit_event('CONSENT_UPDATED',member.id,jsonb_build_object('marketing',marketing,'profiling',profiling));
end $$;
create function public.club_cancel_request(target_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare member public.club_members;request public.club_requests;begin
 perform public.club_verified_identity();select * into member from public.club_members where auth_user_id=auth.uid() and active for update;
 if not found then raise exception 'Iscrizione non attiva.' using errcode='42501';end if;
 select * into request from public.club_requests where id=target_id and member_id=member.id for update;
 if not found then raise exception 'Richiesta non disponibile.' using errcode='42501';end if;
 if request.status='cancelled' then return;end if;
 if request.status not in ('pending','approved','ready') then raise exception 'La richiesta non è più annullabile dall’app.';end if;
 insert into public.club_wallet_movements(member_id,request_id,kind,available_delta,reserved_delta,reason) values(member.id,target_id,'release',request.reserved_amount,-request.reserved_amount,'Annullata dal cliente');
 if request.reward_id is not null then update public.club_rewards set stock=stock+1,updated_at=clock_timestamp() where id=request.reward_id;end if;
 update public.club_requests set status='cancelled',updated_at=clock_timestamp(),completion_reference='Annullata dal cliente' where id=target_id;
 perform public.club_audit_event('REQUEST_CANCELLED',target_id,jsonb_build_object('source','member'));
end $$;

create function public.club_claim_store_invite(invitation_token text) returns text language plpgsql security definer set search_path=public as $$
declare identity uuid;invitation public.club_store_invitations;email_address text;begin
 identity:=public.club_verified_identity();perform pg_advisory_xact_lock(hashtext(identity::text));
 if exists(select 1 from public.club_members where auth_user_id=identity) then raise exception 'Questo account è già iscritto come consumatore.';end if;
 if invitation_token is null or length(invitation_token)<>64 then raise exception 'Invito non valido o scaduto.';end if;
 select * into invitation from public.club_store_invitations where token_hash=encode(sha256(convert_to(invitation_token,'UTF8')),'hex') for update;
 if not found or invitation.expires_at<=now() or (invitation.claimed_by is not null and invitation.claimed_by<>identity) then raise exception 'Invito non valido o scaduto.';end if;
 select email into email_address from auth.users where id=identity;
 if lower(email_address)<>lower(invitation.email) then raise exception 'Accedi con l’indirizzo email destinatario dell’invito.';end if;
 if not exists(select 1 from public.club_stores where store_code=invitation.store_code and enabled) then raise exception 'Negozio non abilitato.';end if;
 if exists(select 1 from public.club_store_users where auth_user_id=identity and store_code<>invitation.store_code) then raise exception 'Account già associato a un altro negozio.';end if;
 insert into public.club_store_users(auth_user_id,store_code) values(identity,invitation.store_code) on conflict(auth_user_id) do nothing;
 update public.club_store_invitations set claimed_by=identity,claimed_at=now() where id=invitation.id;
 perform public.club_audit_event('STORE_INVITE_CLAIMED',invitation.id);
 return invitation.store_code;
end $$;

create function public.club_store_portal(search_text text default '',page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare store text;begin
 perform public.club_verified_identity();store:=public.club_store_code();
 if store is null then raise exception 'Accesso negozio non attivo.' using errcode='42501';end if;
 if length(search_text)>100 or page_offset<0 then raise exception 'Ricerca non valida.';end if;
 return (with customers as materialized (
  select m.id,m.member_code,a.nome as name from public.club_members m join public.crm_accounts a on a.id=m.crm_account_id
  where m.trusted_store_code=store and m.active and (coalesce(search_text,'')='' or concat_ws(' ',m.member_code,a.nome) ilike '%'||search_text||'%')
 ) select jsonb_build_object('store_name',(select ragione_sociale from public.ordini_clienti_cache where codice_cliente=store),'total',(select count(*) from customers),
 'rows',coalesce((select jsonb_agg(to_jsonb(v)) from(select * from customers order by name,id limit 25 offset page_offset) v),'[]'),
 'pending_pickups',(select count(*) from public.club_requests r join public.club_members m on m.id=r.member_id where m.trusted_store_code=store and r.store_code=store and r.status in ('approved','ready') and r.delivery_method in ('pickup','store_cash'))));
end $$;
create function public.club_lookup_member(member_code text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare store text;member public.club_members;begin
 perform public.club_verified_identity();store:=public.club_store_code();
 if store is null then raise exception 'Accesso negozio non attivo.' using errcode='42501';end if;
 select m.* into member from public.club_members m where m.member_code=upper(btrim(club_lookup_member.member_code)) and m.trusted_store_code=store and m.active;
 if not found then raise exception 'Cliente non disponibile per questo negozio.' using errcode='42501';end if;
 return jsonb_build_object('id',member.id,'name',(select nome from public.crm_accounts where id=member.crm_account_id),'member_code',member.member_code,
 'available',(select coalesce(sum(available_delta),0) from public.club_wallet_movements where member_id=member.id));
end $$;
create function public.club_store_products(search_text text default '',page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.club_verified_identity();if public.club_store_code() is null then raise exception 'Accesso negozio non attivo.' using errcode='42501';end if;
 if length(search_text)>100 or page_offset<0 then raise exception 'Ricerca non valida.';end if;
 return coalesce((select jsonb_agg(to_jsonb(v)) from(select id,nome as name,codice_mexal as code from public.prodotti where attivo_mexal and mostra_in_app and codice_mexal ilike 'IT%' and (coalesce(search_text,'')='' or concat_ws(' ',nome,codice_mexal) ilike '%'||search_text||'%') order by nome,id limit 30 offset page_offset) v),'[]');
end $$;
create function public.club_record_purchase(member_code text,items jsonb,idempotency_key uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare store text;member public.club_members;config public.club_configurations;purchase public.club_purchases;line jsonb;product public.prodotti;total numeric(14,2):=0;cashback numeric(14,2);qty numeric;line_amount numeric;begin
 perform public.club_verified_identity();store:=public.club_store_code();
 if store is null then raise exception 'Accesso negozio non attivo.' using errcode='42501';end if;
 select m.* into member from public.club_members m where m.member_code=upper(btrim(club_record_purchase.member_code)) and m.trusted_store_code=store and m.active for update;
 if not found then raise exception 'Cliente non disponibile per questo negozio.' using errcode='42501';end if;
 if idempotency_key is null then raise exception 'Identificativo acquisto obbligatorio.';end if;
 select * into purchase from public.club_purchases p where p.member_id=member.id and p.idempotency_key=club_record_purchase.idempotency_key;
 if found then
  if purchase.store_code<>store then raise exception 'Acquisto non disponibile per questo negozio.' using errcode='42501';end if;
  return jsonb_build_object('id',purchase.id,'amount',purchase.amount,'cashback',purchase.cashback);
 end if;
 if items is null or jsonb_typeof(items)<>'array' or jsonb_array_length(items) not between 1 and 100 then raise exception 'Inserisci da 1 a 100 righe prodotto.';end if;
 select * into config from public.club_configurations where status='published' and effective_at<=now() order by effective_at desc,published_at desc,id limit 1;
 if not found then raise exception 'Programma cashback non ancora attivo.';end if;
 for line in select * from jsonb_array_elements(items) loop
  qty:=(line->>'quantity')::numeric;line_amount:=(line->>'amount')::numeric;
  if qty is null or qty<=0 or qty='NaN'::numeric or qty<>round(qty,3) or line_amount is null or line_amount<0 or line_amount='NaN'::numeric or line_amount<>round(line_amount,2) then raise exception 'Quantità o importo di riga non valido.';end if;
  if not exists(select 1 from public.prodotti where id=(line->>'product_id')::uuid and attivo_mexal and mostra_in_app and codice_mexal ilike 'IT%') then raise exception 'Prodotto non valido per il programma.';end if;
  total:=total+line_amount;
 end loop;
 if total<=0 then raise exception 'Il totale deve essere maggiore di zero.';end if;
 cashback:=round(total*config.cashback_percent/100,2);
 insert into public.club_purchases(member_id,store_code,configuration_id,amount,cashback,idempotency_key,recorded_by) values(member.id,store,config.id,total,cashback,idempotency_key,auth.uid()) returning * into purchase;
 for line in select * from jsonb_array_elements(items) loop
  select * into product from public.prodotti where id=(line->>'product_id')::uuid;
  insert into public.club_purchase_items(purchase_id,product_id,product_name,quantity,amount) values(purchase.id,product.id,product.nome,(line->>'quantity')::numeric,(line->>'amount')::numeric);
 end loop;
 insert into public.club_wallet_movements(member_id,purchase_id,kind,available_delta,reason) values(member.id,purchase.id,'earn',cashback,'Cashback acquisto');
 insert into public.crm_customer_events(account_id,fase,fonte,dati) values(member.crm_account_id,'acquisto','SalidischiaClub',jsonb_build_object('event','PURCHASE_REGISTERED','purchase_id',purchase.id,'amount',total,'cashback',cashback));
 perform public.club_audit_event('PURCHASE_REGISTERED',purchase.id,jsonb_build_object('amount',total,'cashback',cashback,'store',store));
 return jsonb_build_object('id',purchase.id,'amount',total,'cashback',cashback);
end $$;
create function public.club_store_pickups() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare store text;begin
 perform public.club_verified_identity();store:=public.club_store_code();if store is null then raise exception 'Accesso negozio non attivo.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(v)) from(select r.id,r.reward_name,r.amount,r.mode,r.status,r.created_at,m.member_code,a.nome as customer_name
 from public.club_requests r join public.club_members m on m.id=r.member_id join public.crm_accounts a on a.id=m.crm_account_id
 where m.trusted_store_code=store and r.store_code=store and r.delivery_method='pickup' and r.status in ('approved','ready') order by r.created_at,r.id limit 100) v),'[]');
end $$;
create function public.club_store_handover(target_id uuid,pickup_code text) returns void language plpgsql security definer set search_path=public as $$
declare store text;member_id uuid;request public.club_requests;begin
 perform public.club_verified_identity();store:=public.club_store_code();if store is null then raise exception 'Accesso negozio non attivo.' using errcode='42501';end if;
 select r.member_id into member_id from public.club_requests r join public.club_members m on m.id=r.member_id where r.id=target_id and r.store_code=store and m.trusted_store_code=store;
 if member_id is null then raise exception 'Richiesta non disponibile per questo negozio.' using errcode='42501';end if;
 perform 1 from public.club_members m where m.id=member_id for update;
 select * into request from public.club_requests where id=target_id for update;
 if request.pickup_code is distinct from upper(btrim(club_store_handover.pickup_code)) then raise exception 'Codice di ritiro non valido.';end if;
 if request.status='completed' then return;end if;
 if request.status not in ('approved','ready') or request.delivery_method<>'pickup' then raise exception 'Richiesta non pronta per il ritiro.';end if;
 insert into public.club_wallet_movements(member_id,request_id,kind,available_delta,reserved_delta,reason) values(request.member_id,target_id,'spend',0,-request.reserved_amount,'Consegna verificata dal negozio');
 update public.club_requests set status='completed',completed_at=now(),updated_at=clock_timestamp(),completion_reference='Consegna con codice di ritiro verificato' where id=target_id;
 insert into public.crm_customer_events(account_id,fase,fonte,dati) select crm_account_id,'loyalty','SalidischiaClub',jsonb_build_object('event','REWARD_REDEEMED','request_id',target_id) from public.club_members m where m.id=request.member_id;
 perform public.club_audit_event('REQUEST_COMPLETED',target_id,jsonb_build_object('source','store','store',store));
end $$;

create function public.club_store_history(page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare store text;begin
 perform public.club_verified_identity();store:=public.club_store_code();if store is null then raise exception 'Accesso negozio non attivo.' using errcode='42501';end if;
 if page_offset<0 then raise exception 'Pagina non valida.';end if;
 return (with purchases as materialized (
 select p.id,p.amount,p.cashback,p.status,p.created_at,a.nome as customer_name from public.club_purchases p
 join public.club_members m on m.id=p.member_id join public.crm_accounts a on a.id=m.crm_account_id
 where p.store_code=store and m.trusted_store_code=store
 ) select jsonb_build_object('total',(select count(*) from purchases),'rows',coalesce((select jsonb_agg(to_jsonb(v)) from(select * from purchases order by created_at desc,id limit 20 offset page_offset) v),'[]')));
end $$;
create function public.club_reverse_purchase(target_id uuid,reason text) returns void language plpgsql security definer set search_path=public as $$
declare store text;member public.club_members;purchase public.club_purchases;balance numeric;begin
 perform public.club_verified_identity();store:=public.club_store_code();if store is null then raise exception 'Accesso negozio non attivo.' using errcode='42501';end if;
 select m.* into member from public.club_members m join public.club_purchases p on p.member_id=m.id where p.id=target_id and p.store_code=store and m.trusted_store_code=store for update of m;
 if not found then raise exception 'Acquisto non disponibile per questo negozio.' using errcode='42501';end if;
 select * into purchase from public.club_purchases where id=target_id for update;
 if purchase.status='reversed' then return;end if;
 if reason is null or length(btrim(reason)) not between 1 and 1000 then raise exception 'Indica la motivazione dello storno.';end if;
 select coalesce(sum(available_delta),0) into balance from public.club_wallet_movements where member_id=member.id;
 if balance<purchase.cashback then raise exception 'Il cashback è già utilizzato o riservato. Contatta l’assistenza Club.';end if;
 insert into public.club_wallet_movements(member_id,purchase_id,kind,available_delta,reason) values(member.id,target_id,'reverse',-purchase.cashback,btrim(reason));
 update public.club_purchases set status='reversed',reversed_by=auth.uid(),reversal_reason=btrim(reason) where id=target_id;
 insert into public.crm_customer_events(account_id,fase,fonte,dati) values(member.crm_account_id,'refund','SalidischiaClub',jsonb_build_object('event','PURCHASE_REVERSED','purchase_id',target_id,'cashback',purchase.cashback));
 perform public.club_audit_event('PURCHASE_REVERSED',target_id,jsonb_build_object('reason',btrim(reason)));
end $$;

-- CRM controls store activation and invitations; no shop can assign itself.
insert into public.workspace_schermate(codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,icona,metadati,ultima_sincronizzazione)
values('crm.online.club.negozi','Club · Negozi e accessi','Negozi aderenti, inviti operatori e documenti del programma.','workspace','/crm/online/salidischiaclub/negozi','crm.club.negozi',false,true,495,'crm','store','{"crm_area":"SalidischiaClub","parent_path":"/crm/online"}',now());
insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu) values('crm_online','crm.online.club.negozi',495,false,true);
create function public.club_admin_stores() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform public.club_require_staff('negozi');
 return jsonb_build_object('settings',(select to_jsonb(s) from public.club_public_settings s where id),
 'owners',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',concat_ws(' ',u.nome,u.cognome))) from public.utenti u join public.ruoli r on r.id=u.ruolo_id where u.attivo is not false and r.amministratore_workspace),'[]'),
 'stores',coalesce((select jsonb_agg(to_jsonb(v)) from(select c.codice_cliente as store_code,c.ragione_sociale as name,coalesce(s.enabled,false) as enabled,
 (select count(*) from public.club_store_users u where u.store_code=c.codice_cliente and u.active) as operators
 from public.ordini_clienti_cache c join public.crm_classified_customers classified on classified.codice_cliente=c.codice_cliente and classified.area_crm='b2b'
 left join public.club_stores s on s.store_code=c.codice_cliente where c.attivo_mexal is not false order by c.ragione_sociale,c.codice_cliente) v),'[]'),
 'operators',coalesce((select jsonb_agg(jsonb_build_object('id',u.auth_user_id,'store_code',u.store_code,'email',a.email,'active',u.active)) from public.club_store_users u join auth.users a on a.id=u.auth_user_id),'[]'));
end $$;
create function public.club_admin_public_settings(payload jsonb) returns void language plpgsql security definer set search_path=public as $$
begin perform public.club_require_staff('negozi','amministrazione');
 if not exists(select 1 from public.utenti u join public.ruoli r on r.id=u.ruolo_id where u.id=(payload->>'crm_owner_id')::uuid and u.attivo is not false and r.amministratore_workspace) then raise exception 'Seleziona un responsabile CRM amministratore.';end if;
 update public.club_public_settings set crm_owner_id=(payload->>'crm_owner_id')::uuid,privacy_url=nullif(btrim(payload->>'privacy_url'),''),terms_url=nullif(btrim(payload->>'terms_url'),''),support_email=coalesce(payload->>'support_email',''),updated_at=clock_timestamp() where id;
 perform public.club_audit_event('PUBLIC_SETTINGS_UPDATED',(payload->>'crm_owner_id')::uuid);
end $$;
create function public.club_admin_enable_store(target_store_code text,is_enabled boolean) returns void language plpgsql security definer set search_path=public as $$
begin perform public.club_require_staff('negozi','scrittura');
 if not exists(select 1 from public.crm_classified_customers where codice_cliente=target_store_code and area_crm='b2b') then raise exception 'Seleziona un cliente CRM BtoB.';end if;
 insert into public.club_stores(store_code,enabled) values(target_store_code,is_enabled) on conflict(store_code) do update set enabled=excluded.enabled,updated_at=clock_timestamp();
 perform public.club_audit_event('STORE_UPDATED',gen_random_uuid(),jsonb_build_object('store',target_store_code,'enabled',is_enabled));
end $$;
create function public.club_admin_invite_store(target_store_code text,email_address text) returns text language plpgsql security definer set search_path=public as $$
declare token text;begin perform public.club_require_staff('negozi','scrittura');
 if not exists(select 1 from public.club_stores where store_code=target_store_code and enabled) then raise exception 'Abilita prima il negozio.';end if;
 if email_address is null or length(email_address)>254 or email_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Indirizzo email non valido.';end if;
 token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into public.club_store_invitations(store_code,email,token_hash) values(target_store_code,lower(btrim(email_address)),encode(sha256(convert_to(token,'UTF8')),'hex'));
 perform public.club_audit_event('STORE_INVITED',gen_random_uuid(),jsonb_build_object('store',target_store_code));return token;
end $$;
create function public.club_admin_operator(target_auth_id uuid,is_active boolean) returns void language plpgsql security definer set search_path=public as $$
begin perform public.club_require_staff('negozi','scrittura');
 update public.club_store_users set active=is_active where auth_user_id=target_auth_id;
 if not found then raise exception 'Operatore non trovato.';end if;
 perform public.club_audit_event('STORE_OPERATOR_UPDATED',target_auth_id,jsonb_build_object('active',is_active));
end $$;

do $$declare f record;begin
 for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (
 'club_classify_auth_identity','club_block_workspace_profile','club_verified_identity','club_store_code','club_public_info','club_session','club_enroll_member','club_list_stores','club_select_store','club_member_portal','club_member_history','club_update_consents','club_cancel_request','club_claim_store_invite','club_store_portal','club_lookup_member','club_store_products','club_record_purchase','club_store_pickups','club_store_handover','club_store_history','club_reverse_purchase','club_admin_stores','club_admin_public_settings','club_admin_enable_store','club_admin_invite_store','club_admin_operator') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.proname not in ('club_classify_auth_identity','club_block_workspace_profile','club_verified_identity','club_store_code') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
grant execute on function public.club_public_info() to anon;

-- Additional defence for every legacy table/API in the shared Supabase project.
create function public.club_external_identity() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'club_only'='true');
$$;
revoke all on function public.club_external_identity() from public,anon,authenticated;
grant execute on function public.club_external_identity() to authenticated;
do $$declare relation record;begin
 for relation in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where (n.nspname='public' or (n.nspname='storage' and c.relname in ('objects','buckets'))) and c.relkind in ('r','p') and c.relrowsecurity and c.relname not like 'club\_%' escape '\' loop
  execute format('create policy club_identity_boundary on %I.%I as restrictive for all to authenticated using (not public.club_external_identity()) with check (not public.club_external_identity())',relation.nspname,relation.relname);
 end loop;
end $$;
create function public.club_api_boundary() returns void language plpgsql stable security definer set search_path=public as $$
declare request_path text;begin
 if not public.club_external_identity() then return;end if;
 request_path:=current_setting('request.path',true);
 if request_path is null or not(request_path=any(array[
  '/rpc/club_public_info','/rpc/club_session','/rpc/club_enroll_member','/rpc/club_list_stores','/rpc/club_select_store','/rpc/club_member_portal','/rpc/club_member_history','/rpc/club_update_consents','/rpc/club_cancel_request','/rpc/club_create_request','/rpc/club_claim_store_invite','/rpc/club_store_portal','/rpc/club_lookup_member','/rpc/club_store_products','/rpc/club_record_purchase','/rpc/club_store_pickups','/rpc/club_store_handover','/rpc/club_store_history','/rpc/club_reverse_purchase'
 ])) then raise exception 'Questo account è riservato alle API Club.' using errcode='42501';end if;
end $$;
revoke all on function public.club_api_boundary() from public,anon,authenticated;
grant execute on function public.club_api_boundary() to anon,authenticated,service_role;
do $$declare configured_hook text;begin
 select value into configured_hook from pg_roles r cross join lateral unnest(r.rolconfig) value where r.rolname='authenticator' and value like 'pgrst.db_pre_request=%';
 if configured_hook is not null and configured_hook<>'pgrst.db_pre_request=public.club_api_boundary' then raise exception 'Existing API hook must be preserved before Club deployment.';end if;
end $$;
alter role authenticator set pgrst.db_pre_request='public.club_api_boundary';
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;

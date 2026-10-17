begin;

-- Club is a CRM BtoC subarea, with the existing Workspace screen authority.
insert into public.workspace_schermate
 (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,icona,metadati,ultima_sincronizzazione)
select 'crm.online.club.'||s.code,s.name,s.description,'workspace','/crm/online/salidischiaclub'||s.path,
 'crm.club.'||s.code,false,true,490+s.position,'crm',s.icon,
 '{"crm_area":"SalidischiaClub","parent_path":"/crm/online"}'::jsonb,now()
from (values
 ('dashboard','SalidischiaClub','Dashboard Fidelity, cashback e richieste.','','gift',0),
 ('richieste','Club · Richieste','Approvazione e gestione dei riscatti.','/richieste','clipboard',1),
 ('configurazione','Club · Configurazione','Percentuale cashback, rimborsi e consegne.','/configurazione','settings',2),
 ('premi','Club · Premi','Catalogo prodotti e premi.','/premi','gift',3),
 ('clienti','Club · Clienti e movimenti','Iscritti e ledger del programma.','/clienti','users',4)
) s(code,name,description,path,icon,position)
on conflict(codice) do update set nome=excluded.nome,descrizione=excluded.descrizione,
 percorso=excluded.percorso,chiave_componente=excluded.chiave_componente,attiva=true,
 metadati=workspace_schermate.metadati||excluded.metadati,ultima_sincronizzazione=now();
insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
select 'crm_online',codice,ordine,false,true from public.workspace_schermate where codice like 'crm.online.club.%'
on conflict(modulo_codice,schermata_codice) do update set ordine=excluded.ordine,visibile_menu=true;

create function public.club_staff_allowed(screen_name text, required_level text default 'lettura')
returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(public.workspace_internal_user() and
   public.crm_has_module_level('crm_online',required_level) and
   public.workspace_screen_level_for_user(public.workspace_current_profile_id(),'crm.online.club.'||screen_name)
    = any(case when required_level='amministrazione' then array['amministrazione']
               when required_level='scrittura' then array['scrittura','amministrazione']
               else array['lettura','scrittura','amministrazione'] end),false);
$$;

create table public.club_configurations (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(btrim(name)) between 1 and 120),
 status text not null default 'draft' check(status in ('draft','published')),
 cashback_percent numeric(5,2) not null check(cashback_percent between 0 and 100),
 reimbursement_modes text[] not null check(cardinality(reimbursement_modes)>0 and reimbursement_modes<@array['products','prizes','money']::text[]),
 delivery_methods text[] not null check(delivery_methods<@array['pickup','home']::text[]),
 cash_minimum numeric(14,2) not null default 20 check(cash_minimum>=0 and cash_minimum<>'NaN'::numeric),
 cash_method text not null default 'bank_transfer' check(cash_method in ('bank_transfer','store_cash')),
 shipping_fee numeric(14,2) not null default 0 check(shipping_fee>=0 and shipping_fee<>'NaN'::numeric),
 shipping_payment text not null default 'company' check(shipping_payment in ('wallet','separate','company')),
 free_shipping_threshold numeric(14,2) check(free_shipping_threshold>=0 and free_shipping_threshold<>'NaN'::numeric),
 effective_at timestamptz,
 created_by uuid not null references public.utenti(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 published_at timestamptz,
 check(status='draft' or (effective_at is not null and published_at is not null)),
 check(reimbursement_modes=array['money']::text[] or cardinality(delivery_methods)>0)
);
create index club_configuration_active_idx on public.club_configurations(effective_at desc) where status='published';
create table public.club_rewards (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('products','prizes')),
 product_id uuid references public.prodotti(id) on delete restrict,
 name text not null check(length(btrim(name)) between 1 and 200),
 description text not null default '' check(length(description)<=4000),
 budget_required numeric(14,2) not null check(budget_required>0 and budget_required<>'NaN'::numeric),
 stock integer not null check(stock>=0),
 delivery_methods text[] not null check(cardinality(delivery_methods)>0 and delivery_methods<@array['pickup','home']::text[]),
 active boolean not null default true,
 valid_until timestamptz,
 updated_at timestamptz not null default now(),
 check((kind='products' and product_id is not null) or (kind='prizes' and product_id is null))
);
create table public.club_members (
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid not null unique references auth.users(id) on delete restrict,
 crm_account_id uuid not null unique references public.crm_accounts(id) on delete restrict,
 member_code text not null unique default ('CLUB-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16))),
 trusted_store_code text references public.ordini_clienti_cache(codice_cliente) on update cascade on delete restrict,
 active boolean not null default true,
 joined_at timestamptz not null default now()
);
create index club_members_store_idx on public.club_members(trusted_store_code);
create table public.club_purchases (
 id uuid primary key default gen_random_uuid(), member_id uuid not null references public.club_members(id),
 store_code text not null references public.ordini_clienti_cache(codice_cliente),
 configuration_id uuid not null references public.club_configurations(id),
 amount numeric(14,2) not null check(amount>0 and amount<>'NaN'::numeric),
 cashback numeric(14,2) not null check(cashback>=0 and cashback<>'NaN'::numeric),
 status text not null default 'confirmed' check(status in ('confirmed','reversed')),
 idempotency_key uuid not null,created_at timestamptz not null default now(),
 unique(member_id,idempotency_key)
);
create table public.club_purchase_items (
 id uuid primary key default gen_random_uuid(),purchase_id uuid not null references public.club_purchases(id),
 product_id uuid not null references public.prodotti(id),
 quantity numeric(14,3) not null check(quantity>0 and quantity<>'NaN'::numeric),
 amount numeric(14,2) not null check(amount>=0 and amount<>'NaN'::numeric)
);
create table public.club_requests (
 id uuid primary key default gen_random_uuid(),member_id uuid not null references public.club_members(id),
 configuration_id uuid not null references public.club_configurations(id),
 reward_id uuid references public.club_rewards(id),
 mode text not null check(mode in ('products','prizes','money')),
 reward_name text not null,
 amount numeric(14,2) not null check(amount>0 and amount<>'NaN'::numeric),
 shipping_fee numeric(14,2) not null default 0 check(shipping_fee>=0 and shipping_fee<>'NaN'::numeric),
 shipping_payment text not null check(shipping_payment in ('wallet','separate','company')),
 reserved_amount numeric(14,2) not null check(reserved_amount>0 and reserved_amount<>'NaN'::numeric),
 delivery_method text not null check(delivery_method in ('pickup','home','bank_transfer','store_cash')),
 store_code text references public.ordini_clienti_cache(codice_cliente),
 delivery_details jsonb not null default '{}',
 status text not null default 'pending' check(status in ('pending','approved','ready','shipped','completed','cancelled','rejected')),
 idempotency_key uuid not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 approved_by uuid references public.utenti(id),approved_at timestamptz,completed_at timestamptz,
 completion_reference text,
 unique(member_id,idempotency_key),
 check((mode='money' and reward_id is null and delivery_method in ('bank_transfer','store_cash')) or
       (mode<>'money' and reward_id is not null and delivery_method in ('pickup','home'))),
 check(delivery_method not in ('pickup','store_cash') or store_code is not null)
);
create index club_requests_status_idx on public.club_requests(status,created_at desc);
create index club_requests_member_idx on public.club_requests(member_id,created_at desc);
create table public.club_wallet_movements (
 id uuid primary key default gen_random_uuid(),member_id uuid not null references public.club_members(id),
 purchase_id uuid references public.club_purchases(id),request_id uuid references public.club_requests(id),
 kind text not null check(kind in ('earn','reserve','release','spend','reverse')),
 available_delta numeric(14,2) not null check(available_delta<>'NaN'::numeric),
 reserved_delta numeric(14,2) not null default 0 check(reserved_delta<>'NaN'::numeric),
 reason text not null,created_at timestamptz not null default now(),
 check((kind='earn' and purchase_id is not null and request_id is null and available_delta>=0 and reserved_delta=0) or
 (kind='reverse' and purchase_id is not null and request_id is null and available_delta<=0 and reserved_delta=0) or
 (kind='reserve' and request_id is not null and purchase_id is null and available_delta<0 and reserved_delta=-available_delta) or
 (kind='release' and request_id is not null and purchase_id is null and available_delta>0 and reserved_delta=-available_delta) or
 (kind='spend' and request_id is not null and purchase_id is null and available_delta=0 and reserved_delta<0))
);
create index club_wallet_member_idx on public.club_wallet_movements(member_id,created_at);
create unique index club_wallet_request_kind_unique on public.club_wallet_movements(request_id,kind) where request_id is not null;
create unique index club_wallet_purchase_kind_unique on public.club_wallet_movements(purchase_id,kind) where purchase_id is not null;
create table public.club_audit (
 id uuid primary key default gen_random_uuid(),actor_id uuid references public.utenti(id),
 auth_user_id uuid,event text not null,entity_id uuid not null,details jsonb not null default '{}',created_at timestamptz not null default now()
);

-- No frontend can directly edit configurations, requests, wallet or audit.
do $$ declare t text; begin
 foreach t in array array['club_configurations','club_rewards','club_members','club_purchases','club_purchase_items','club_requests','club_wallet_movements','club_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

create function public.club_audit_event(event_name text,target_id uuid,event_details jsonb default '{}')
returns void language sql security definer set search_path=public as $$
 insert into public.club_audit(actor_id,auth_user_id,event,entity_id,details)
 values(public.workspace_current_profile_id(),auth.uid(),event_name,target_id,event_details);
$$;
create function public.club_require_staff(screen_name text,required_level text default 'lettura')
returns void language plpgsql stable security definer set search_path=public as $$
begin
 if not public.club_staff_allowed(screen_name,required_level) then
  raise exception 'Accesso SalidischiaClub non autorizzato.' using errcode='42501';
 end if;
end $$;

create function public.club_save_configuration(payload jsonb,target_id uuid default null,expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare config_id uuid; current_row public.club_configurations;begin
 perform public.club_require_staff('configurazione','scrittura');
 if target_id is not null then
  select * into current_row from public.club_configurations where id=target_id for update;
  if not found or current_row.status<>'draft' then raise exception 'La configurazione non è una bozza modificabile.';end if;
  if expected_updated_at is null or current_row.updated_at<>expected_updated_at then raise exception 'La bozza è stata modificata. Ricarica prima di salvare.' using errcode='40001';end if;
 end if;
 insert into public.club_configurations(id,name,cashback_percent,reimbursement_modes,delivery_methods,cash_minimum,cash_method,shipping_fee,shipping_payment,free_shipping_threshold,effective_at,created_by,updated_at)
 values(coalesce(target_id,gen_random_uuid()),btrim(payload->>'name'),(payload->>'cashback_percent')::numeric,
 array(select jsonb_array_elements_text(payload->'reimbursement_modes')),array(select jsonb_array_elements_text(payload->'delivery_methods')),
 (payload->>'cash_minimum')::numeric,payload->>'cash_method',(payload->>'shipping_fee')::numeric,payload->>'shipping_payment',
 nullif(payload->>'free_shipping_threshold','')::numeric,nullif(payload->>'effective_at','')::timestamptz,public.workspace_current_profile_id(),clock_timestamp())
 on conflict(id) do update set name=excluded.name,cashback_percent=excluded.cashback_percent,
 reimbursement_modes=excluded.reimbursement_modes,delivery_methods=excluded.delivery_methods,cash_minimum=excluded.cash_minimum,
 cash_method=excluded.cash_method,shipping_fee=excluded.shipping_fee,shipping_payment=excluded.shipping_payment,
 free_shipping_threshold=excluded.free_shipping_threshold,effective_at=excluded.effective_at,updated_at=excluded.updated_at
 returning id into config_id;
 perform public.club_audit_event('CONFIGURATION_SAVED',config_id);
 return config_id;
end $$;

create function public.club_publish_configuration(target_id uuid,expected_updated_at timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare config public.club_configurations;begin
 perform public.club_require_staff('configurazione','amministrazione');
 perform pg_advisory_xact_lock(hashtext('salidischiaclub.configuration'));
 select * into config from public.club_configurations where id=target_id for update;
 if not found then raise exception 'Configurazione non trovata.';end if;
 if config.status='published' then return config.id;end if;
 if expected_updated_at is null or config.updated_at<>expected_updated_at then raise exception 'La bozza è cambiata. Ricarica prima di pubblicare.' using errcode='40001';end if;
 if config.effective_at is null then raise exception 'Indica la decorrenza prima della pubblicazione.';end if;
 if exists(select 1 from public.club_configurations where status='published' and effective_at=config.effective_at) then raise exception 'Esiste già una versione pubblicata con questa decorrenza.';end if;
 update public.club_configurations set status='published',published_at=now(),updated_at=clock_timestamp() where id=target_id;
 perform public.club_audit_event('CONFIGURATION_PUBLISHED',target_id,to_jsonb(config));
 return target_id;
end $$;

create function public.club_save_reward(payload jsonb,target_id uuid default null,expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare reward_id uuid; current_row public.club_rewards;begin
 perform public.club_require_staff('premi','scrittura');
 if target_id is not null then
  select * into current_row from public.club_rewards where id=target_id for update;
  if not found then raise exception 'Premio non trovato.';end if;
  if expected_updated_at is null or current_row.updated_at<>expected_updated_at then raise exception 'Premio modificato da un altro operatore. Ricarica.' using errcode='40001';end if;
 end if;
 insert into public.club_rewards(id,kind,product_id,name,description,budget_required,stock,delivery_methods,active,valid_until,updated_at)
 values(coalesce(target_id,gen_random_uuid()),payload->>'kind',nullif(payload->>'product_id','')::uuid,btrim(payload->>'name'),coalesce(payload->>'description',''),
 (payload->>'budget_required')::numeric,(payload->>'stock')::integer,array(select jsonb_array_elements_text(payload->'delivery_methods')),
 (payload->>'active')::boolean,nullif(payload->>'valid_until','')::timestamptz,clock_timestamp())
 on conflict(id) do update set kind=excluded.kind,product_id=excluded.product_id,name=excluded.name,description=excluded.description,
 budget_required=excluded.budget_required,stock=excluded.stock,delivery_methods=excluded.delivery_methods,active=excluded.active,valid_until=excluded.valid_until,updated_at=excluded.updated_at
 returning id into reward_id;
 perform public.club_audit_event('REWARD_SAVED',reward_id,payload);
 return reward_id;
end $$;

-- Called by an authenticated Club member; does not create a Workspace user.
create function public.club_create_request(target_reward_id uuid,target_mode text,target_amount numeric,target_delivery text,target_details jsonb,idempotency_key uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare member public.club_members; config public.club_configurations; reward public.club_rewards;
 existing_id uuid; request_id uuid; cost numeric(14,2); fee numeric(14,2):=0; debit numeric(14,2); balance numeric;begin
 select * into member from public.club_members where auth_user_id=auth.uid() and active for update;
 if not found then raise exception 'Iscrizione Club non attiva.' using errcode='42501';end if;
 if idempotency_key is null then raise exception 'Identificativo richiesta obbligatorio.';end if;
 select id into existing_id from public.club_requests r where r.member_id=member.id and r.idempotency_key=club_create_request.idempotency_key;
 if found then return existing_id;end if;
 select * into config from public.club_configurations where status='published' and effective_at<=now() order by effective_at desc,published_at desc,id limit 1;
 if not found then raise exception 'Programma non ancora attivo.';end if;
 if target_mode is null or not(target_mode=any(config.reimbursement_modes)) then raise exception 'Modalità di rimborso non disponibile.';end if;
 if target_mode='money' then
  if target_reward_id is not null or target_amount is null or target_amount<=0 or target_amount='NaN'::numeric or target_amount<>round(target_amount,2) or target_amount<config.cash_minimum or target_delivery is distinct from config.cash_method then
   raise exception 'Importo o metodo di rimborso non valido.';end if;
  cost:=target_amount;
 else
  select * into reward from public.club_rewards where id=target_reward_id and active and (valid_until is null or valid_until>now()) for update;
  if not found or reward.kind<>target_mode or reward.stock<1 then raise exception 'Premio non disponibile.';end if;
  if target_delivery is null or not(target_delivery=any(reward.delivery_methods)) or not(target_delivery=any(config.delivery_methods)) then raise exception 'Consegna non disponibile.';end if;
  cost:=reward.budget_required;
  if target_delivery='home' and (config.free_shipping_threshold is null or cost<config.free_shipping_threshold) then fee:=config.shipping_fee;end if;
 end if;
 if target_details is null or jsonb_typeof(target_details)<>'object' or octet_length(target_details::text)>4000 then raise exception 'Dati di consegna non validi.';end if;
 if target_delivery in ('pickup','store_cash') and member.trusted_store_code is null then raise exception 'Seleziona un negozio di fiducia.';end if;
 if target_delivery='home' and exists(select 1 from unnest(array['recipient','street','city','postal_code','country']) k where nullif(btrim(target_details->>k),'') is null) then raise exception 'Indirizzo di consegna incompleto.';end if;
 if target_delivery='bank_transfer' and nullif(btrim(target_details->>'iban'),'') is null then raise exception 'Indica il conto per il rimborso.';end if;
 debit:=cost+case when config.shipping_payment='wallet' then fee else 0 end;
 select coalesce(sum(available_delta),0) into balance from public.club_wallet_movements where member_id=member.id;
 if balance<debit then raise exception 'Budget cashback insufficiente.';end if;
 insert into public.club_requests(member_id,configuration_id,reward_id,mode,reward_name,amount,shipping_fee,shipping_payment,reserved_amount,delivery_method,store_code,delivery_details,idempotency_key)
 values(member.id,config.id,target_reward_id,target_mode,case when target_mode='money' then 'Rimborso in denaro' else reward.name end,cost,fee,config.shipping_payment,debit,target_delivery,
 case when target_delivery in ('pickup','store_cash') then member.trusted_store_code end,target_details,idempotency_key) returning id into request_id;
 insert into public.club_wallet_movements(member_id,request_id,kind,available_delta,reserved_delta,reason) values(member.id,request_id,'reserve',-debit,debit,'Budget riservato per richiesta');
 if target_mode<>'money' then update public.club_rewards set stock=stock-1,updated_at=clock_timestamp() where id=reward.id;end if;
 perform public.club_audit_event('REQUEST_CREATED',request_id,jsonb_build_object('amount',debit,'mode',target_mode));
 return request_id;
end $$;

create function public.club_transition_request(target_id uuid,target_status text,reference text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare request public.club_requests; member_id uuid; reservation numeric;begin
 perform public.club_require_staff('richieste','scrittura');
 select r.member_id into member_id from public.club_requests r where id=target_id;
 if not found then raise exception 'Richiesta non trovata.';end if;
 -- All wallet operations lock the member first, then the request/reward.
 perform 1 from public.club_members m where m.id=member_id for update;
 select * into request from public.club_requests where id=target_id for update;
 if request.status=target_status then return to_jsonb(request);end if;
 if target_status is null or not (
  (request.status='pending' and target_status in ('approved','rejected','cancelled')) or
  (request.status='approved' and (target_status='cancelled' or (target_status='ready' and request.delivery_method in ('pickup','store_cash')) or (target_status='shipped' and request.delivery_method='home') or (target_status='completed' and request.delivery_method in ('bank_transfer','store_cash')))) or
  (request.status='ready' and target_status in ('completed','cancelled')) or
  (request.status='shipped' and target_status='completed')
 ) then raise exception 'Passaggio di stato non consentito: % → %.',request.status,target_status;end if;
 select coalesce(sum(reserved_delta),0) into reservation from public.club_wallet_movements where request_id=target_id;
 if reservation<>request.reserved_amount then raise exception 'Riserva cashback incoerente. Richiesta da verificare.';end if;
 if target_status in ('cancelled','rejected') and nullif(btrim(reference),'') is null then raise exception 'Indica la motivazione.';end if;
 if target_status='completed' and nullif(btrim(reference),'') is null then raise exception 'Indica il riferimento di consegna o pagamento.';end if;
 if length(reference)>1000 then raise exception 'Riferimento troppo lungo.';end if;
 if target_status in ('cancelled','rejected') then
  insert into public.club_wallet_movements(member_id,request_id,kind,available_delta,reserved_delta,reason) values(request.member_id,target_id,'release',request.reserved_amount,-request.reserved_amount,reference);
  if request.reward_id is not null then update public.club_rewards set stock=stock+1,updated_at=clock_timestamp() where id=request.reward_id;end if;
 elsif target_status='completed' then
  insert into public.club_wallet_movements(member_id,request_id,kind,available_delta,reserved_delta,reason) values(request.member_id,target_id,'spend',0,-request.reserved_amount,reference);
 end if;
 update public.club_requests set status=target_status,updated_at=clock_timestamp(),
 approved_at=case when target_status='approved' then now() else approved_at end,
 approved_by=case when target_status='approved' then public.workspace_current_profile_id() else approved_by end,
 completed_at=case when target_status='completed' then now() else completed_at end,
 completion_reference=case when target_status in ('completed','cancelled','rejected') then reference else completion_reference end
 where id=target_id returning * into request;
 perform public.club_audit_event('REQUEST_'||upper(target_status),target_id,jsonb_build_object('reference',reference));
 if target_status='completed' then
  insert into public.crm_customer_events(account_id,fase,fonte,dati,creato_da)
  select crm_account_id,'loyalty','SalidischiaClub',jsonb_build_object('event','REWARD_REDEEMED','request_id',target_id,'amount',request.amount),public.workspace_current_profile_id()
  from public.club_members m where m.id=request.member_id;
 end if;
 return to_jsonb(request);
end $$;

create function public.club_admin_dashboard(date_from date,date_to date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.club_require_staff('dashboard');
 if date_from is null or date_to is null or date_from>date_to then raise exception 'Periodo non valido.';end if;
 return jsonb_build_object(
  'members',(select count(*) from public.club_members),
  'active_members',(select count(*) from public.club_members where active),
  'new_members',(select count(*) from public.club_members where joined_at>=date_from::timestamp at time zone 'Europe/Rome' and joined_at<(date_to+1)::timestamp at time zone 'Europe/Rome'),
  'pending_requests',(select count(*) from public.club_requests where status='pending'),
  'processing_requests',(select count(*) from public.club_requests where status in ('approved','ready','shipped')),
  'completed_requests',(select count(*) from public.club_requests where status='completed' and completed_at>=date_from::timestamp at time zone 'Europe/Rome' and completed_at<(date_to+1)::timestamp at time zone 'Europe/Rome'),
  'sales',(select coalesce(sum(amount),0) from public.club_purchases where status='confirmed' and created_at>=date_from::timestamp at time zone 'Europe/Rome' and created_at<(date_to+1)::timestamp at time zone 'Europe/Rome'),
  'cashback_earned',(select coalesce(sum(cashback),0) from public.club_purchases where status='confirmed' and created_at>=date_from::timestamp at time zone 'Europe/Rome' and created_at<(date_to+1)::timestamp at time zone 'Europe/Rome'),
  'available_budget',(select coalesce(sum(available_delta),0) from public.club_wallet_movements),
  'reserved_budget',(select coalesce(sum(reserved_delta),0) from public.club_wallet_movements),
  'active_configuration',(select jsonb_build_object('name',name,'cashback_percent',cashback_percent,'effective_at',effective_at) from public.club_configurations where status='published' and effective_at<=now() order by effective_at desc,published_at desc,id limit 1)
 );
end $$;

create function public.club_admin_requests(status_filter text default 'pending',search_text text default '',page_offset integer default 0,page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 perform public.club_require_staff('richieste');
 if page_offset<0 or page_size<1 or page_size>100 or length(search_text)>200 then raise exception 'Parametri elenco non validi.';end if;
 with filtered as materialized (
  select r.*,a.nome as customer_name,a.email as customer_email,m.member_code,
   c.ragione_sociale as store_name,concat_ws(' ',u.nome,u.cognome) as approved_by_name
  from public.club_requests r join public.club_members m on m.id=r.member_id join public.crm_accounts a on a.id=m.crm_account_id
  left join public.ordini_clienti_cache c on c.codice_cliente=r.store_code left join public.utenti u on u.id=r.approved_by
  where (coalesce(status_filter,'')='' or r.status=status_filter or (status_filter='processing' and r.status in ('approved','ready','shipped'))) and
   (coalesce(search_text,'')='' or concat_ws(' ',a.nome,a.email,m.member_code,r.id::text,r.reward_name,c.ragione_sociale) ilike '%'||search_text||'%')
 ) select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(rows)) from (select * from filtered order by created_at desc,id limit page_size offset page_offset) rows),'[]')) into result;
 return result;
end $$;

create function public.club_admin_configuration()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform public.club_require_staff('configurazione');
 return jsonb_build_object('versions',coalesce((select jsonb_agg(to_jsonb(v) order by created_at desc,id) from public.club_configurations v),'[]'));
end $$;
create function public.club_admin_rewards()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform public.club_require_staff('premi');
 return coalesce((select jsonb_agg(to_jsonb(r) order by r.name,r.id) from public.club_rewards r),'[]');
end $$;
create function public.club_admin_members(search_text text default '',page_offset integer default 0,page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.club_require_staff('clienti');
 if page_offset<0 or page_size<1 or page_size>100 or length(search_text)>200 then raise exception 'Parametri elenco non validi.';end if;
 return (with filtered as materialized (
  select m.*,a.nome as customer_name,a.email as customer_email,c.ragione_sociale as store_name,
  coalesce(w.available,0) as available,coalesce(w.reserved,0) as reserved,coalesce(w.used,0) as used
  from public.club_members m join public.crm_accounts a on a.id=m.crm_account_id
  left join public.ordini_clienti_cache c on c.codice_cliente=m.trusted_store_code
  left join lateral(select sum(available_delta) as available,sum(reserved_delta) as reserved,-sum(reserved_delta) filter(where kind='spend') as used from public.club_wallet_movements w where w.member_id=m.id) w on true
  where coalesce(search_text,'')='' or concat_ws(' ',a.nome,a.email,m.member_code,c.ragione_sociale) ilike '%'||search_text||'%'
 ) select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(v)) from (select * from filtered order by joined_at desc,id limit page_size offset page_offset) v),'[]')));
end $$;
create function public.club_admin_movements(target_member_id uuid,page_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin perform public.club_require_staff('clienti');
 if page_offset<0 then raise exception 'Pagina non valida.';end if;
 return jsonb_build_object('total',(select count(*) from public.club_wallet_movements where member_id=target_member_id),
 'rows',coalesce((select jsonb_agg(to_jsonb(v)) from (select * from public.club_wallet_movements where member_id=target_member_id order by created_at desc,id limit 25 offset page_offset) v),'[]'));
end $$;

-- Private implementation helpers cannot be called through PostgREST.
revoke all on function public.club_staff_allowed(text,text),public.club_require_staff(text,text),public.club_audit_event(text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.club_save_configuration(jsonb,uuid,timestamptz),public.club_publish_configuration(uuid,timestamptz),public.club_save_reward(jsonb,uuid,timestamptz),public.club_create_request(uuid,text,numeric,text,jsonb,uuid),public.club_transition_request(uuid,text,text),public.club_admin_dashboard(date,date),public.club_admin_requests(text,text,integer,integer),public.club_admin_configuration(),public.club_admin_rewards(),public.club_admin_members(text,integer,integer),public.club_admin_movements(uuid,integer) from public,anon,authenticated;
grant execute on function public.club_save_configuration(jsonb,uuid,timestamptz),public.club_publish_configuration(uuid,timestamptz),public.club_save_reward(jsonb,uuid,timestamptz),public.club_create_request(uuid,text,numeric,text,jsonb,uuid),public.club_transition_request(uuid,text,text),public.club_admin_dashboard(date,date),public.club_admin_requests(text,text,integer,integer),public.club_admin_configuration(),public.club_admin_rewards(),public.club_admin_members(text,integer,integer),public.club_admin_movements(uuid,integer) to authenticated;

notify pgrst,'reload schema';
commit;

begin;

alter table public.crm_accounts
  add column if not exists geo_latitude double precision,
  add column if not exists geo_longitude double precision,
  add column if not exists geo_accuracy_meters numeric(10,2),
  add column if not exists geo_address text,
  add column if not exists geo_updated_at timestamptz;

create table if not exists public.crm_visit_details (
  activity_id uuid primary key references public.crm_activities(id) on delete cascade,
  legacy_giornata_id uuid unique,
  visit_status text not null default 'pianificata'
    check (visit_status in ('pianificata','in_corso','completata','annullata')),
  target_latitude double precision,
  target_longitude double precision,
  target_address text,
  check_in_at timestamptz,
  check_in_latitude double precision,
  check_in_longitude double precision,
  check_in_accuracy_meters numeric(10,2),
  check_in_address text,
  check_in_distance_meters numeric(10,2),
  check_in_geofence text check (check_in_geofence in ('compatibile','fuori_soglia','precisione_insufficiente','sede_non_geocodificata')),
  check_in_exception_reason text,
  check_out_at timestamptz,
  check_out_latitude double precision,
  check_out_longitude double precision,
  check_out_accuracy_meters numeric(10,2),
  check_out_address text,
  check_out_distance_meters numeric(10,2),
  check_out_geofence text check (check_out_geofence in ('compatibile','fuori_soglia','precisione_insufficiente','sede_non_geocodificata')),
  check_out_exception_reason text,
  outcome text,
  report_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_visit_details_status_idx
  on public.crm_visit_details(visit_status, check_in_at, check_out_at);

create or replace function public.crm_distance_meters(
  p_lat1 double precision,
  p_lon1 double precision,
  p_lat2 double precision,
  p_lon2 double precision
) returns numeric
language sql immutable parallel safe
as $$
  select case
    when p_lat1 is null or p_lon1 is null or p_lat2 is null or p_lon2 is null then null
    else round((6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat2-p_lat1)/2),2) +
      cos(radians(p_lat1))*cos(radians(p_lat2))*power(sin(radians(p_lon2-p_lon1)/2),2)
    )))::numeric, 2)
  end
$$;

create or replace function public.crm_beauty_geofence_result(
  p_accuracy numeric,
  p_distance numeric
) returns text
language sql immutable parallel safe
as $$
  select case
    when p_distance is null then 'sede_non_geocodificata'
    when p_accuracy is null or p_accuracy > 100 then 'precisione_insufficiente'
    when p_distance > 150 then 'fuori_soglia'
    else 'compatibile'
  end
$$;

create or replace function public.crm_create_beauty_visit(
  p_customer_code text,
  p_customer_name text,
  p_address text,
  p_city text,
  p_phone text,
  p_email text,
  p_title text,
  p_starts_at timestamptz,
  p_target_latitude double precision default null,
  p_target_longitude double precision default null,
  p_legacy_giornata_id uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
  v_actor uuid := public.workspace_current_profile_id();
  v_account public.crm_accounts%rowtype;
  v_customer public.ordini_clienti_cache%rowtype;
  v_activity_id uuid;
begin
  if v_actor is null or not public.crm_has_module_level('crm_b2b','scrittura') then
    raise exception 'Creazione visita non autorizzata';
  end if;
  if p_starts_at is null then raise exception 'Data della visita obbligatoria'; end if;
  if nullif(btrim(p_idempotency_key),'') is not null then
    select id into v_activity_id from public.crm_activities where idempotency_key=btrim(p_idempotency_key);
    if found then return jsonb_build_object('activity_id',v_activity_id,'idempotent',true); end if;
  end if;

  if nullif(btrim(p_customer_code),'') is not null then
    select * into v_account from public.crm_accounts
    where tipo='b2b' and codice_cliente_mexal=btrim(p_customer_code) limit 1;
    if not found then
      select * into v_customer from public.ordini_clienti_cache
      where codice_cliente=btrim(p_customer_code) and attivo_mexal is true limit 1;
      if not found then raise exception 'Cliente Mexal non trovato o non autorizzato'; end if;
      insert into public.crm_accounts(tipo,nome,stato,responsabile_id,codice_cliente_mexal,fonte,
        partita_iva,email,telefono,indirizzo,citta,provincia,paese,creato_da)
      values('b2b',coalesce(nullif(btrim(v_customer.ragione_sociale),''),btrim(p_customer_code)),'cliente',v_actor,
        btrim(p_customer_code),'mexal',v_customer.partita_iva,v_customer.email,
        v_customer.telefono,v_customer.indirizzo,v_customer.localita,v_customer.provincia,v_customer.paese,v_actor)
      returning * into v_account;
    end if;
  else
    if nullif(btrim(p_customer_name),'') is null or nullif(btrim(p_address),'') is null then
      raise exception 'Nome e indirizzo del nuovo prospect sono obbligatori';
    end if;
    insert into public.crm_accounts(tipo,nome,stato,responsabile_id,fonte,email,telefono,indirizzo,citta,creato_da)
    values('b2b',btrim(p_customer_name),'prospect',v_actor,'beauty_field',nullif(btrim(p_email),''),
      nullif(btrim(p_phone),''),btrim(p_address),nullif(btrim(p_city),''),v_actor)
    returning * into v_account;
  end if;

  if not public.crm_row_visible(coalesce(v_account.responsabile_id,v_actor),v_account.reparto_id,'crm_b2b') then
    raise exception 'Cliente fuori dal perimetro autorizzato';
  end if;
  insert into public.crm_activities(crm_tipo,account_id,tipo,titolo,stato,data_attivita,responsabile_id,reparto_id,
    source_type,source_id,idempotency_key,creato_da)
  values('b2b',v_account.id,'visita_beauty',coalesce(nullif(btrim(p_title),''),'Visita Beauty - '||v_account.nome),
    'pianificata',p_starts_at,coalesce(v_account.responsabile_id,v_actor),v_account.reparto_id,
    case when p_legacy_giornata_id is null then 'beauty_crm' else 'beauty_legacy' end,p_legacy_giornata_id,
    nullif(btrim(p_idempotency_key),''),v_actor)
  returning id into v_activity_id;
  insert into public.crm_visit_details(activity_id,legacy_giornata_id,target_latitude,target_longitude,target_address)
  values(v_activity_id,p_legacy_giornata_id,p_target_latitude,p_target_longitude,nullif(btrim(p_address),''));
  insert into public.crm_audit_log(utente_id,entita_tipo,entita_id,operazione,dettagli)
  values(v_actor,'beauty_visit',v_activity_id,'visita_creata',jsonb_build_object('account_id',v_account.id,'legacy_giornata_id',p_legacy_giornata_id));
  return jsonb_build_object('activity_id',v_activity_id,'account_id',v_account.id,'idempotent',false);
end $$;

create or replace function public.crm_beauty_check_in(
  p_activity_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters numeric,
  p_address text default null,
  p_exception_reason text default null
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
  v_activity public.crm_activities%rowtype;
  v_visit public.crm_visit_details%rowtype;
  v_distance numeric;
  v_geofence text;
begin
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Coordinate GPS non valide';
  end if;
  select * into v_activity from public.crm_activities where id=p_activity_id for update;
  if not found or v_activity.crm_tipo <> 'b2b' or v_activity.tipo <> 'visita_beauty' then
    raise exception 'Visita Beauty non trovata o non autorizzata';
  end if;
  if not public.crm_has_module_level('crm_b2b','scrittura')
     or not public.crm_row_visible(v_activity.responsabile_id,v_activity.reparto_id,'crm_b2b') then
    raise exception 'Check-in non autorizzato';
  end if;
  select * into v_visit from public.crm_visit_details where activity_id=p_activity_id for update;
  if not found then raise exception 'Dettaglio visita non configurato'; end if;
  if v_visit.check_in_at is not null then
    return jsonb_build_object('activity_id',p_activity_id,'check_in_at',v_visit.check_in_at,'idempotent',true);
  end if;
  v_distance := public.crm_distance_meters(p_latitude,p_longitude,v_visit.target_latitude,v_visit.target_longitude);
  v_geofence := public.crm_beauty_geofence_result(p_accuracy_meters,v_distance);
  if v_geofence <> 'compatibile' and nullif(btrim(p_exception_reason),'') is null then
    raise exception 'Motivazione obbligatoria: rilevazione GPS %', replace(v_geofence,'_',' ');
  end if;
  update public.crm_visit_details set
    visit_status='in_corso', check_in_at=now(), check_in_latitude=p_latitude,
    check_in_longitude=p_longitude, check_in_accuracy_meters=p_accuracy_meters,
    check_in_address=nullif(btrim(p_address),''), check_in_distance_meters=v_distance,
    check_in_geofence=v_geofence, check_in_exception_reason=nullif(btrim(p_exception_reason),''),
    updated_at=now()
  where activity_id=p_activity_id;
  update public.crm_activities set stato='in_corso',aggiornato_il=now() where id=p_activity_id;
  insert into public.crm_audit_log(utente_id,entita_tipo,entita_id,operazione,dettagli)
  values(public.workspace_current_profile_id(),'beauty_visit',p_activity_id,'check_in',
    jsonb_build_object('accuracy_meters',p_accuracy_meters,'distance_meters',v_distance,'geofence',v_geofence));
  return jsonb_build_object('activity_id',p_activity_id,'check_in_at',now(),'distance_meters',v_distance,'geofence',v_geofence,'idempotent',false);
end $$;

create or replace function public.crm_beauty_check_out(
  p_activity_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters numeric,
  p_address text,
  p_outcome text,
  p_next_type text default null,
  p_next_topic text default null,
  p_next_at timestamptz default null,
  p_exception_reason text default null
) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare
  v_activity public.crm_activities%rowtype;
  v_visit public.crm_visit_details%rowtype;
  v_distance numeric;
  v_geofence text;
  v_next_id uuid;
  v_without_followup boolean;
begin
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Coordinate GPS non valide';
  end if;
  select * into v_activity from public.crm_activities where id=p_activity_id for update;
  if not found or v_activity.crm_tipo <> 'b2b' or v_activity.tipo <> 'visita_beauty' then
    raise exception 'Visita Beauty non trovata o non autorizzata';
  end if;
  if not public.crm_has_module_level('crm_b2b','scrittura')
     or not public.crm_row_visible(v_activity.responsabile_id,v_activity.reparto_id,'crm_b2b') then
    raise exception 'Check-out non autorizzato';
  end if;
  select * into v_visit from public.crm_visit_details where activity_id=p_activity_id for update;
  if not found or v_visit.check_in_at is null then raise exception 'Eseguire prima il check-in'; end if;
  if v_visit.check_out_at is not null then
    return jsonb_build_object('activity_id',p_activity_id,'check_out_at',v_visit.check_out_at,'idempotent',true);
  end if;
  if nullif(btrim(p_outcome),'') is null then raise exception 'Esito della visita obbligatorio'; end if;
  v_without_followup := lower(btrim(p_outcome)) in ('cliente_non_interessato','annullata','nessun_seguito');
  if v_without_followup then
    if nullif(btrim(p_exception_reason),'') is null then raise exception 'Motivazione obbligatoria per chiudere senza prossima attività'; end if;
  elsif nullif(btrim(p_next_type),'') is null or nullif(btrim(p_next_topic),'') is null or p_next_at is null then
    raise exception 'Tipo, argomento e data della prossima attività sono obbligatori';
  end if;
  v_distance := public.crm_distance_meters(p_latitude,p_longitude,v_visit.target_latitude,v_visit.target_longitude);
  v_geofence := public.crm_beauty_geofence_result(p_accuracy_meters,v_distance);
  if v_geofence <> 'compatibile' and nullif(btrim(p_exception_reason),'') is null then
    raise exception 'Motivazione obbligatoria: rilevazione GPS %', replace(v_geofence,'_',' ');
  end if;
  if not v_without_followup then
    insert into public.crm_activities(crm_tipo,account_id,opportunity_id,tipo,titolo,descrizione,stato,data_attivita,responsabile_id,reparto_id,source_type,source_id,creato_da)
    values('b2b',v_activity.account_id,v_activity.opportunity_id,btrim(p_next_type),btrim(p_next_topic),
      'Generata dalla chiusura della visita Beauty','pianificata',p_next_at,v_activity.responsabile_id,v_activity.reparto_id,
      'beauty_visit',v_activity.id,public.workspace_current_profile_id())
    returning id into v_next_id;
  end if;
  update public.crm_visit_details set
    visit_status='completata', check_out_at=now(), check_out_latitude=p_latitude,
    check_out_longitude=p_longitude, check_out_accuracy_meters=p_accuracy_meters,
    check_out_address=nullif(btrim(p_address),''), check_out_distance_meters=v_distance,
    check_out_geofence=v_geofence, check_out_exception_reason=nullif(btrim(p_exception_reason),''),
    outcome=btrim(p_outcome), updated_at=now()
  where activity_id=p_activity_id;
  update public.crm_activities set stato='completata',completata_il=now(),esito=btrim(p_outcome),
    prossima_azione=nullif(btrim(p_next_topic),''),aggiornato_il=now() where id=p_activity_id;
  insert into public.crm_audit_log(utente_id,entita_tipo,entita_id,operazione,dettagli)
  values(public.workspace_current_profile_id(),'beauty_visit',p_activity_id,'check_out',
    jsonb_build_object('accuracy_meters',p_accuracy_meters,'distance_meters',v_distance,'geofence',v_geofence,'next_activity_id',v_next_id,'outcome',p_outcome));
  return jsonb_build_object('activity_id',p_activity_id,'check_out_at',now(),'distance_meters',v_distance,'geofence',v_geofence,'next_activity_id',v_next_id,'idempotent',false);
end $$;

create or replace function public.crm_touch_visit_details_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists trg_crm_visit_details_updated on public.crm_visit_details;
create trigger trg_crm_visit_details_updated before update on public.crm_visit_details
for each row execute function public.crm_touch_visit_details_updated_at();

create or replace function public.crm_anonymize_expired_beauty_coordinates()
returns integer
language plpgsql security definer set search_path=public as $$
declare
  v_count integer;
begin
  if current_user <> 'postgres' and auth.role() <> 'service_role' and not public.workspace_user_is_admin() then
    raise exception 'Operazione non autorizzata';
  end if;
  update public.crm_visit_details
  set check_in_latitude=null,
      check_in_longitude=null,
      check_in_accuracy_meters=null,
      check_in_address=null,
      check_out_latitude=null,
      check_out_longitude=null,
      check_out_accuracy_meters=null,
      check_out_address=null,
      report_data=coalesce(report_data,'{}'::jsonb)||jsonb_build_object('coordinate_anonymized_at',now()),
      updated_at=now()
  where coalesce(check_out_at,check_in_at) < now()-interval '12 months'
    and (check_in_latitude is not null or check_out_latitude is not null);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

alter table public.crm_visit_details enable row level security;
drop policy if exists "crm visit details read" on public.crm_visit_details;
create policy "crm visit details read" on public.crm_visit_details for select to authenticated
using (exists(select 1 from public.crm_activities a where a.id=activity_id
  and public.crm_row_visible(a.responsabile_id,a.reparto_id,'crm_b2b')));
drop policy if exists "crm visit details write" on public.crm_visit_details;
create policy "crm visit details write" on public.crm_visit_details for all to authenticated
using (exists(select 1 from public.crm_activities a where a.id=activity_id
  and public.crm_row_visible(a.responsabile_id,a.reparto_id,'crm_b2b')
  and public.crm_has_module_level('crm_b2b','scrittura')))
with check (exists(select 1 from public.crm_activities a where a.id=activity_id
  and public.crm_row_visible(a.responsabile_id,a.reparto_id,'crm_b2b')
  and public.crm_has_module_level('crm_b2b','scrittura')));

revoke all on public.crm_visit_details from public,anon;
grant select,insert,update,delete on public.crm_visit_details to authenticated;
grant all on public.crm_visit_details to service_role;
revoke all on function public.crm_beauty_check_in(uuid,double precision,double precision,numeric,text,text) from public,anon;
revoke all on function public.crm_beauty_check_out(uuid,double precision,double precision,numeric,text,text,text,text,timestamptz,text) from public,anon;
revoke all on function public.crm_create_beauty_visit(text,text,text,text,text,text,text,timestamptz,double precision,double precision,uuid,text) from public,anon;
grant execute on function public.crm_create_beauty_visit(text,text,text,text,text,text,text,timestamptz,double precision,double precision,uuid,text) to authenticated,service_role;
grant execute on function public.crm_beauty_check_in(uuid,double precision,double precision,numeric,text,text) to authenticated,service_role;
grant execute on function public.crm_beauty_check_out(uuid,double precision,double precision,numeric,text,text,text,text,timestamptz,text) to authenticated,service_role;
revoke all on function public.crm_anonymize_expired_beauty_coordinates() from public,anon;
grant execute on function public.crm_anonymize_expired_beauty_coordinates() to authenticated,service_role;

comment on table public.crm_visit_details is 'Dettaglio 1:1 delle visite Beauty: GPS acquisito esclusivamente su check-in e check-out, soglia 150 metri.';
comment on function public.crm_beauty_check_out(uuid,double precision,double precision,numeric,text,text,text,text,timestamptz,text) is 'Chiude atomicamente la visita e crea la prossima attivita obbligatoria, salvo esiti motivati senza seguito.';
comment on function public.crm_anonymize_expired_beauty_coordinates() is 'Rimuove le coordinate precise di check-in/out dopo 12 mesi, preservando audit, distanze, esiti e storico operativo.';

create extension if not exists pg_cron;
do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='crm-beauty-coordinate-retention';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
end $$;
select cron.schedule(
  'crm-beauty-coordinate-retention',
  '20 3 * * *',
  'select public.crm_anonymize_expired_beauty_coordinates();'
);

commit;

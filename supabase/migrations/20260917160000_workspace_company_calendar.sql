begin;
-- Immutable effective-dated company calendar. Intervals use civil Europe/Rome time.
create table public.workspace_company_calendar_versions (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique,
  week jsonb not null,
  note text not null default '',
  created_by uuid references public.utenti(id),
  created_at timestamptz not null default now()
);
create table public.workspace_company_calendar_exceptions (
  id uuid primary key default gen_random_uuid(),
  day date not null unique,
  intervals jsonb not null,
  reason text not null check(length(btrim(reason)) between 1 and 300),
  created_by uuid references public.utenti(id),
  updated_at timestamptz not null default now()
);
create table public.workspace_company_calendar_imports (
  source_key text primary key, imported_at timestamptz not null default now()
);
alter table public.workspace_company_calendar_versions enable row level security;
alter table public.workspace_company_calendar_exceptions enable row level security;
alter table public.workspace_company_calendar_imports enable row level security;
revoke all on public.workspace_company_calendar_versions,public.workspace_company_calendar_exceptions,public.workspace_company_calendar_imports from anon,authenticated;

-- Keep the MES baseline exactly: Mon-Fri 07:30-16:30, no invented break.
insert into public.workspace_company_calendar_versions(effective_from,week,note)
values('1900-01-01','{"1":[["07:30","16:30"]],"2":[["07:30","16:30"]],"3":[["07:30","16:30"]],"4":[["07:30","16:30"]],"5":[["07:30","16:30"]],"6":[],"7":[]}', 'Configurazione iniziale MES: 07:30–16:30, lunedì–venerdì');

create function public.workspace_calendar_validate_intervals(p_value jsonb) returns void
language plpgsql set search_path=public as $$
declare slot jsonb; previous_end text:='00:00';
begin
  if jsonb_typeof(p_value) is distinct from 'array' or jsonb_array_length(p_value)>8 then raise exception 'Intervalli non validi'; end if;
  for slot in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(slot) is distinct from 'array' or jsonb_array_length(slot)<>2 or
      coalesce(slot->>0,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or
      coalesce(slot->>1,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or
      (slot->>0)>=(slot->>1) or (slot->>0)<previous_end then
      raise exception 'Usa fasce HH:MM ordinate, senza sovrapposizioni e con fine successiva all’inizio';
    end if;
    previous_end:=slot->>1;
  end loop;
end $$;

-- National holidays are now calculated by Workspace, including Easter Monday.
create function public.workspace_calendar_holidays(p_year integer)
returns table(day date, reason text) language plpgsql immutable set search_path=public as $$
declare a integer; b integer; c integer; d integer; e integer; f integer; g integer;
 h integer; i integer; k integer; l integer; m integer; easter date;
begin
 a:=p_year%19;b:=p_year/100;c:=p_year%100;d:=b/4;e:=b%4;f:=(b+8)/25;
 g:=(b-f+1)/3;h:=(19*a+b-d-g+15)%30;i:=c/4;k:=c%4;
 l:=(32+2*e+2*i-h-k)%7;m:=(a+11*h+22*l)/451;
 easter:=make_date(p_year,(h+l-7*m+114)/31,(h+l-7*m+114)%31+1);
 return query select make_date(p_year,v.month,v.date),v.name from (values
 (1,1,'Capodanno'),(1,6,'Epifania'),(4,25,'Liberazione'),(5,1,'Festa del lavoro'),
 (6,2,'Festa della Repubblica'),(8,15,'Assunzione'),(11,1,'Ognissanti'),
 (12,8,'Immacolata'),(12,25,'Natale'),(12,26,'Santo Stefano')) v(month,date,name);
 return query select easter,'Pasqua'::text union all select easter+1,'Lunedì dell’Angelo';
 if p_year>=2026 then return query select make_date(p_year,10,4),'San Francesco d’Assisi'::text; end if;
end $$;

create function public.workspace_company_calendar_data() returns jsonb
language sql stable security definer set search_path=public as $$
 with horizon as (select extract(year from now() at time zone 'Europe/Rome')::integer y),
 all_closures as (
   select date_from,date_to,name from workspace_hr_closures
   union
   select h.day,h.day,'Festività nazionale · '||h.reason
   from horizon cross join lateral generate_series(y-1,y+10) years(year)
   cross join lateral workspace_calendar_holidays(years.year) h
   where not exists(select 1 from workspace_hr_closures c where h.day between c.date_from and c.date_to)
 )
 select jsonb_build_object('schemaVersion',1,'timezone','Europe/Rome',
  'validUntil',(select make_date(y+10,12,31) from horizon),
  'lastMesSync',(select imported_at from workspace_company_calendar_imports where source_key='mes:calendar-sync'),
  'versions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'effectiveFrom',effective_from,'week',week,'note',note) order by effective_from) from workspace_company_calendar_versions),'[]'),
  'exceptions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'day',day,'intervals',intervals,'reason',reason) order by day) from workspace_company_calendar_exceptions),'[]'),
  'closures',coalesce((select jsonb_agg(jsonb_build_object('from',date_from,'to',date_to,'reason',name) order by date_from) from all_closures),'[]'))
$$;
create function public.workspace_company_calendar_read() returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
  perform workspace_hr_actor();
  return workspace_company_calendar_data();
end $$;

create function public.workspace_company_calendar_save(p_action text,p_data jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare actor uuid:=workspace_hr_actor(); target uuid; day_key text; total_slots integer:=0; d date;
begin
  if not workspace_user_is_admin() then raise exception 'Calendario aziendale riservato agli admin' using errcode='42501'; end if;
  if p_action='version' then
    d:=(p_data->>'effectiveFrom')::date;
    if d is null or d<(now() at time zone 'Europe/Rome')::date then raise exception 'La decorrenza non può modificare giorni passati'; end if;
    if jsonb_typeof(p_data->'week') is distinct from 'object' then raise exception 'Settimana non valida'; end if;
    if (select count(*) from jsonb_object_keys(p_data->'week'))<>7 then raise exception 'Configura esattamente i sette giorni della settimana'; end if;
    for day_key in select generate_series(1,7)::text loop
      perform workspace_calendar_validate_intervals(p_data->'week'->day_key);
      total_slots:=total_slots+jsonb_array_length(p_data->'week'->day_key);
    end loop;
    if total_slots=0 then raise exception 'Configura almeno una fascia lavorativa nella settimana'; end if;
    insert into workspace_company_calendar_versions(effective_from,week,note,created_by)
    values(d,p_data->'week',left(coalesce(p_data->>'note',''),300),actor) returning id into target;
  elsif p_action='exception' then
    d:=(p_data->>'day')::date;
    if d is null or d<(now() at time zone 'Europe/Rome')::date then raise exception 'Non modificare il calendario passato'; end if;
    perform workspace_calendar_validate_intervals(p_data->'intervals');
    insert into workspace_company_calendar_exceptions(day,intervals,reason,created_by)
    values(d,p_data->'intervals',p_data->>'reason',actor)
    on conflict(day) do update set intervals=excluded.intervals,reason=excluded.reason,created_by=actor,updated_at=now()
    returning id into target;
  else raise exception 'Azione non valida'; end if;
  insert into workspace_hr_audit(actor_id,action,target_id,details) values(actor,'calendar.'||p_action,target,p_data);
  return target;
end $$;

-- Service-only one-way adoption of existing MES closures, idempotent by source id.
create function public.workspace_company_calendar_import(p_closures jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare item jsonb; source_id text; starts date; ends date; label text;
begin
  if jsonb_typeof(p_closures) is distinct from 'array' or jsonb_array_length(p_closures)>5000 then raise exception 'Importazione calendario non valida'; end if;
  for item in select value from jsonb_array_elements(p_closures) loop
    source_id:=item->>'key';
    if length(coalesce(source_id,'')) not between 1 and 200 then raise exception 'Riferimento MES mancante'; end if;
    starts:=(item->>'from')::date; ends:=(item->>'to')::date;
    if starts is null or ends is null or ends<starts then raise exception 'Date chiusura MES non valide'; end if;
    label:=left(coalesce(nullif(btrim(item->>'reason'),''),'Chiusura MES'),120);
    insert into workspace_company_calendar_imports(source_key) values(source_id) on conflict do nothing;
    if found then
      insert into workspace_hr_closures(name,date_from,date_to)
      select label,piece::date,least(piece::date+364,ends)
      from generate_series(starts::timestamp,ends::timestamp,interval '365 days') piece
      where not exists(select 1 from workspace_hr_closures where date_from=piece::date and date_to=least(piece::date+364,ends) and name=label);
    end if;
  end loop;
  insert into workspace_company_calendar_imports(source_key) values('mes:calendar-sync')
  on conflict(source_key) do update set imported_at=now();
  return workspace_company_calendar_data();
end $$;
revoke all on function public.workspace_calendar_holidays(integer),public.workspace_calendar_validate_intervals(jsonb),public.workspace_company_calendar_data(),public.workspace_company_calendar_read(),public.workspace_company_calendar_save(text,jsonb),public.workspace_company_calendar_import(jsonb) from public,anon,authenticated;
grant execute on function public.workspace_company_calendar_read(),public.workspace_company_calendar_save(text,jsonb) to authenticated;
grant execute on function public.workspace_company_calendar_data(),public.workspace_company_calendar_import(jsonb) to service_role;
notify pgrst,'reload schema';
commit;

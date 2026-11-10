begin;
-- Dedicated read gate; it never grants company_mes_ai_can_write. The existing
-- MES state endpoint currently returns a company-wide snapshot, so fail closed
-- for scopes that cannot be represented by that endpoint yet.
create function public.workspace_planning_can_read_snapshot() returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce(public.workspace_module_enabled_for_user(public.workspace_current_profile_id(),'progremes')
  and public.workspace_screen_level_for_user(public.workspace_current_profile_id(),'progremes.PlanningProduction') in ('lettura','scrittura','amministrazione')
  and public.workspace_data_scope()->>'mode'='tutti',false)
$$;
revoke all on function public.workspace_planning_can_read_snapshot() from public,anon;
grant execute on function public.workspace_planning_can_read_snapshot() to authenticated;
-- Register capabilities; deliberately do not assign users, departments or roles.
insert into public.workspace_aree(codice,nome,descrizione,icona,ordine,attiva) values
 ('anomalie','Anomalie','Registro centrale delle anomalie aziendali','clipboard-list',115,true);
insert into public.workspace_moduli(codice,nome,tipo,area,aree,percorso,provider,sempre_disponibile,assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,icona)
 values('anomalie','Anomalie','modulo','anomalie',array['anomalie'],'/anomalie','workspace',false,true,true,true,true,115,'clipboard-list');
insert into public.workspace_schermate(codice,nome,provider,percorso,chiave_componente,attiva,ordine,area,aree,icona,metadati)
 values('anomalie.registro','Anomalie','workspace','/anomalie','anomalies',true,115,'anomalie',array['anomalie'],'clipboard-list','{}');
insert into public.workspace_moduli_schermate values('anomalie','anomalie.registro',10,true,true);
insert into public.workspace_menu_voci(codice,nome,icona,ordine,attiva) values('anomalie','Anomalie','clipboard-list',115,true);
insert into public.workspace_menu_moduli values('anomalie','anomalie',10);
insert into public.permessi(codice,descrizione,modulo) values
 ('anomalies.manage','Gestisce anomalie nel proprio ambito','anomalie'),
 ('anomalies.supervise','Assegna e supervisiona anomalie nel proprio ambito','anomalie');
-- Register the new AI-readable modules in the existing capability whitelist.
-- Keep its current per-user/department decisions and admin semantics unchanged.
do $$ declare original text; revised text; begin
 select pg_get_functiondef('public.workspace_ai_capabilities()'::regprocedure) into original;
 revised:=replace(original,'''crm_online'',''messaggi''','''crm_online'',''messaggi'',''magazzino'',''anomalie''');
 if revised=original then raise exception 'UNEXPECTED_AI_CAPABILITY_DEFINITION'; end if;
 execute revised;
end $$;

create table public.anomaly_agents (
 code text primary key, name text not null, enabled boolean not null default false,
 policy_version text not null, timezone text not null default 'Europe/Rome', local_time time not null default '07:00',
 horizon_days integer not null default 28 check(horizon_days=28),
 config_version integer not null default 1,
 recipient_policy jsonb not null default '{"departmentManager":true,"workspaceAdmins":true,"departmentOverrides":{},"additionalUserIds":[]}',
 readiness jsonb not null default '{"ready":false,"reason":"Da verificare: letture complete delle fonti, generazione PDF dal modello Progre e destinatari autorizzati. Invii disattivati."}'
);
insert into public.anomaly_agents(code,name,policy_version) values('fabbisogni','Progre AI — Fabbisogni & Planning','fabbisogni-v1');
create table public.anomaly_runs (
 id uuid primary key default gen_random_uuid(), agent_code text not null references public.anomaly_agents(code),
 business_day date not null, started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null check(status in ('running','complete','incomplete','failed')),
 coverage jsonb not null default '{}', unique(agent_code,business_day)
);
create table public.anomalies (
 id uuid primary key default gen_random_uuid(), agent_code text not null references public.anomaly_agents(code),
 fingerprint text not null check(length(fingerprint)=64), category text not null,
 severity text not null check(severity in ('info','warning','high','critical')),
 title text not null check(length(title) between 1 and 200), description text not null check(length(description)<=4000),
 owner_id uuid references public.utenti(id), department_id uuid references public.reparti(id),
 source_modules text[] not null check(cardinality(source_modules)>0),
 status text not null default 'open' check(status in ('open','acknowledged','investigating','waiting','resolved','dismissed')),
 due_at timestamptz, evidence jsonb not null default '{}', corrective_proposal jsonb,
 task_id uuid references public.v4_fasi_progetto(id), first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(), last_run_id uuid references public.anomaly_runs(id),
 version integer not null default 1, unique(agent_code,fingerprint)
);
create index anomalies_queue on public.anomalies(status,severity,last_seen_at desc);
create index anomalies_department on public.anomalies(department_id);
create table public.anomaly_events (
 id uuid primary key default gen_random_uuid(), anomaly_id uuid not null references public.anomalies(id),
 actor_id uuid references public.utenti(id), kind text not null, body text check(length(body)<=4000),
 before_snapshot jsonb, after_snapshot jsonb, created_at timestamptz not null default now()
);
create index anomaly_events_parent on public.anomaly_events(anomaly_id,created_at);
create table public.anomaly_deliveries (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.anomaly_runs(id),
 recipient_id uuid not null references public.utenti(id), channel text not null check(channel in ('email','notification')),
 content_hash text not null, status text not null check(status in ('pending','accepted','delivered','uncertain','failed')),
 provider_receipt text, created_at timestamptz not null default now(), unique(run_id,recipient_id,channel,content_hash)
);

create function public.anomaly_can_read(p_owner uuid,p_department uuid,p_modules text[]) returns boolean
language sql stable security definer set search_path=public as $$
 select coalesce((select
  'anomalie'=any(public.workspace_area_access_codes(u.auth_user_id))
  and public.workspace_module_enabled_for_user(u.id,'anomalie')
  and public.workspace_screen_level_for_user(u.id,'anomalie.registro')<>'nessuno'
  and not exists(select 1 from unnest(p_modules) m where not public.workspace_module_enabled_for_user(u.id,m))
  and (public.workspace_user_is_admin() or p_owner=u.id or
    (public.workspace_data_scope()->>'mode'='team' and exists(select 1 from public.utenti_reparti ur where ur.utente_id=u.id and ur.reparto_id=p_department)))
 from public.utenti u where u.auth_user_id=auth.uid() and u.attivo is not false),false)
$$;
revoke all on function public.anomaly_can_read(uuid,uuid,text[]) from public,anon;
grant execute on function public.anomaly_can_read(uuid,uuid,text[]) to authenticated;

alter table public.anomaly_agents enable row level security;
alter table public.anomaly_runs enable row level security;
alter table public.anomalies enable row level security;
alter table public.anomaly_events enable row level security;
alter table public.anomaly_deliveries enable row level security;
revoke all on public.anomaly_agents,public.anomaly_runs,public.anomalies,public.anomaly_events,public.anomaly_deliveries from public,anon,authenticated;
grant all on public.anomaly_agents,public.anomaly_runs,public.anomalies,public.anomaly_events,public.anomaly_deliveries to service_role;
grant select on public.anomaly_agents,public.anomaly_runs,public.anomalies,public.anomaly_events to authenticated;
create policy anomalies_read on public.anomalies for select to authenticated using(public.anomaly_can_read(owner_id,department_id,source_modules));
create policy anomaly_events_read on public.anomaly_events for select to authenticated using(exists(select 1 from public.anomalies a where a.id=anomaly_id));
-- Run coverage can contain source identifiers: reserve it to the authorized supervisor.
create policy anomaly_runs_read on public.anomaly_runs for select to authenticated using(public.anomaly_can_read(null,null,array['progremes','magazzino']) and public.workspace_user_is_admin());
create policy anomaly_agents_read on public.anomaly_agents for select to authenticated using(public.anomaly_can_read(public.workspace_current_profile_id(),null,array['anomalie']));
create function public.anomaly_dashboard() returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('total',count(*),'open',count(*) filter(where status in ('open','acknowledged','investigating','waiting')),
 'critical',count(*) filter(where severity='critical' and status not in ('resolved','dismissed')),
 'high',count(*) filter(where severity='high' and status not in ('resolved','dismissed')),
 'resolved',count(*) filter(where status='resolved')) from public.anomalies
$$;
revoke all on function public.anomaly_dashboard() from public,anon;
grant execute on function public.anomaly_dashboard() to authenticated;
create function public.anomaly_task_accessible(p_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select not public.club_external_identity() and public.workspace_module_enabled_for_user(public.workspace_current_profile_id(),'attivita') and exists(
  select 1 from public.v4_fasi_progetto t where t.id=p_id and
  (not public.workspace_customer_record_scope() or t.id=any(public.workspace_visible_phase_ids())) and
  (public.workspace_user_is_admin() or t.creato_da=public.workspace_current_profile_id() or t.assegnato_a=public.workspace_current_profile_id() or t.id=any(public.workspace_visible_phase_ids())))
$$;
revoke all on function public.anomaly_task_accessible(uuid) from public,anon;
grant execute on function public.anomaly_task_accessible(uuid) to authenticated;

create function public.anomaly_audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.anomaly_events(anomaly_id,actor_id,kind,before_snapshot,after_snapshot)
 values(new.id,public.workspace_current_profile_id(),lower(tg_op),case when tg_op='UPDATE' then to_jsonb(old) end,to_jsonb(new));
 return new;
end $$;
revoke all on function public.anomaly_audit() from public,anon,authenticated;
-- AFTER permits the audit FK to reference a newly inserted anomaly.
create trigger anomaly_audit after insert or update on public.anomalies for each row execute function public.anomaly_audit();
create function public.anomaly_version() returns trigger language plpgsql set search_path=public as $$
begin new.version:=old.version+1; return new; end $$;
revoke all on function public.anomaly_version() from public,anon,authenticated;
create trigger anomaly_version before update on public.anomalies for each row execute function public.anomaly_version();

-- Extend the existing BRAIN_REVIEW proposal channel, preserving all other tools.
alter table public.second_brain_proposals drop constraint second_brain_proposals_tool_check;
alter table public.second_brain_proposals add constraint second_brain_proposals_tool_check
 check(tool in ('MEMORY_SAVE','ACTIVITY_CREATE','PROJECT_UPDATE','TASK_UPDATE','ANOMALY_UPDATE','ANOMALY_CONFIGURE'));
create function public.anomaly_guard_proposal() returns trigger language plpgsql set search_path=public as $$
begin
 if new.tool in ('ANOMALY_UPDATE','ANOMALY_CONFIGURE') or (tg_op='UPDATE' and old.tool in ('ANOMALY_UPDATE','ANOMALY_CONFIGURE')) then
  if current_user<>(select pg_get_userbyid(relowner) from pg_class where oid='public.second_brain_proposals'::regclass) then
   raise exception 'ANOMALY_PROPOSAL_REQUIRES_RPC' using errcode='42501';
  end if;
  if tg_op='UPDATE' and (new.input is distinct from old.input or new.tool is distinct from old.tool or new.user_id is distinct from old.user_id or new.before_snapshot is distinct from old.before_snapshot) then raise exception 'IMMUTABLE_PROPOSAL'; end if;
 end if;
 return new;
end $$;
revoke all on function public.anomaly_guard_proposal() from public,anon,authenticated;
create trigger anomaly_guard_proposal before insert or update on public.second_brain_proposals for each row execute function public.anomaly_guard_proposal();
create function public.anomaly_propose(p_input jsonb) returns public.second_brain_proposals
language plpgsql security definer set search_path=public as $$
declare a public.anomalies; p public.second_brain_proposals; permission text;
begin
 if not public.second_brain_enabled() or not public.workspace_ai_can_confirm()
  or not coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]') ? 'anomalie' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_input - array['id','expectedVersion','status','ownerId','comment','taskId','correctiveProposal'] <> '{}' then raise exception 'INVALID_INPUT'; end if;
 select * into a from public.anomalies where id=(p_input->>'id')::uuid;
 if not found or not public.anomaly_can_read(a.owner_id,a.department_id,a.source_modules) then raise exception 'NOT_ACCESSIBLE' using errcode='42501'; end if;
 if exists(select 1 from unnest(a.source_modules) m where not coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]') ? m) then raise exception 'SOURCE_AI_SCOPE_REQUIRED' using errcode='42501'; end if;
 if a.version is distinct from (p_input->>'expectedVersion')::integer then raise exception 'RECORD_CHANGED'; end if;
 permission:=case when p_input ? 'ownerId' then 'anomalies.supervise' else 'anomalies.manage' end;
 if not permission=any(public.workspace_operation_codes(public.workspace_current_profile_id())) then raise exception 'SPECIFIC_PERMISSION_REQUIRED' using errcode='42501'; end if;
 if not (p_input ?| array['status','ownerId','comment','taskId','correctiveProposal']) then raise exception 'EMPTY_PROPOSAL'; end if;
 insert into public.second_brain_proposals(user_id,tool,input,before_snapshot)
 values(public.workspace_current_profile_id(),'ANOMALY_UPDATE',p_input,to_jsonb(a)) returning * into p;
 return p;
end $$;
revoke all on function public.anomaly_propose(jsonb) from public,anon;
grant execute on function public.anomaly_propose(jsonb) to authenticated;
create function public.anomaly_configure_propose(p_input jsonb) returns public.second_brain_proposals
language plpgsql security definer set search_path=public as $$
declare p public.second_brain_proposals; a public.anomaly_agents;
begin
 if not public.workspace_user_is_admin() or not public.second_brain_enabled() or not public.workspace_ai_can_confirm()
  or not coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]') ? 'anomalie' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_input - array['expectedVersion','recipientPolicy','enabled'] <> '{}' then raise exception 'INVALID_INPUT'; end if;
 select * into a from public.anomaly_agents where code='fabbisogni';
 if a.config_version is distinct from (p_input->>'expectedVersion')::integer then raise exception 'RECORD_CHANGED'; end if;
 if jsonb_typeof(p_input->'recipientPolicy') is distinct from 'object' then raise exception 'RECIPIENT_POLICY_REQUIRED'; end if;
 insert into public.second_brain_proposals(user_id,tool,input,before_snapshot)
 values(public.workspace_current_profile_id(),'ANOMALY_CONFIGURE',p_input,to_jsonb(a)) returning * into p;
 return p;
end $$;
revoke all on function public.anomaly_configure_propose(jsonb) from public,anon;
grant execute on function public.anomaly_configure_propose(jsonb) to authenticated;
alter function public.second_brain_decide(uuid,boolean) rename to second_brain_decide_existing;
revoke all on function public.second_brain_decide_existing(uuid,boolean) from public,anon;
grant execute on function public.second_brain_decide_existing(uuid,boolean) to authenticated;
create function public.anomaly_decide(p_id uuid,p_confirm boolean) returns public.second_brain_proposals
language plpgsql security definer set search_path=public as $$
declare p public.second_brain_proposals; a public.anomalies; permission text; recipient public.utenti; agent public.anomaly_agents;
begin
 select * into p from public.second_brain_proposals where id=p_id and user_id=public.workspace_current_profile_id() for update;
 if not found then raise exception 'PROPOSAL_NOT_ACCESSIBLE' using errcode='42501'; end if;
 if p.tool not in ('ANOMALY_UPDATE','ANOMALY_CONFIGURE') then raise exception 'WRONG_PROPOSAL_CHANNEL'; end if;
 if p.status<>'proposed' then return p; end if;
 if p_confirm is null or not public.second_brain_enabled() or not public.workspace_ai_can_confirm()
  or not coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]') ? 'anomalie' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p.tool='ANOMALY_CONFIGURE' then
  if not public.workspace_user_is_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into agent from public.anomaly_agents where code='fabbisogni' for update;
  if p_confirm then
   if p.expires_at<now() or agent.config_version is distinct from (p.input->>'expectedVersion')::integer then raise exception 'CONFIGURATION_CHANGED_OR_EXPIRED'; end if;
   if coalesce((p.input->>'enabled')::boolean,false) and coalesce((agent.readiness->>'ready')::boolean,false) is not true then raise exception 'AGENT_NOT_READY'; end if;
   if (p.input->'recipientPolicy') - array['departmentManager','workspaceAdmins','departmentOverrides','additionalUserIds'] <> '{}' or
    jsonb_typeof(p.input->'recipientPolicy'->'departmentManager') is distinct from 'boolean' or jsonb_typeof(p.input->'recipientPolicy'->'workspaceAdmins') is distinct from 'boolean' or
    jsonb_typeof(p.input->'recipientPolicy'->'departmentOverrides') is distinct from 'object' or jsonb_typeof(p.input->'recipientPolicy'->'additionalUserIds') is distinct from 'array' then raise exception 'INVALID_RECIPIENT_POLICY'; end if;
   if exists(select 1 from jsonb_array_elements_text(p.input->'recipientPolicy'->'additionalUserIds') id where not exists(select 1 from public.utenti u where u.id=id::uuid and u.attivo is not false)) or
    exists(select 1 from jsonb_each_text(p.input->'recipientPolicy'->'departmentOverrides') m where not exists(select 1 from public.reparti r where r.id=m.key::uuid) or not exists(select 1 from public.utenti u where u.id=m.value::uuid and u.attivo is not false)) then raise exception 'INVALID_RECIPIENT'; end if;
   update public.anomaly_agents set recipient_policy=p.input->'recipientPolicy',enabled=coalesce((p.input->>'enabled')::boolean,false),config_version=config_version+1 where code=agent.code;
  end if;
  update public.second_brain_proposals set status=case when p_confirm then 'executed' else 'rejected' end,confirmed_at=now(),result=jsonb_build_object('agent','fabbisogni','changed',p_confirm) where id=p_id returning * into p;
  return p;
 end if;
 if p_confirm then
  if p.expires_at<now() then raise exception 'PROPOSAL_EXPIRED'; end if;
  select * into a from public.anomalies where id=(p.input->>'id')::uuid for update;
  permission:=case when p.input ? 'ownerId' then 'anomalies.supervise' else 'anomalies.manage' end;
  if not public.anomaly_can_read(a.owner_id,a.department_id,a.source_modules)
   or not permission=any(public.workspace_operation_codes(public.workspace_current_profile_id())) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if exists(select 1 from unnest(a.source_modules) m where not coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]') ? m) then raise exception 'SOURCE_AI_SCOPE_REQUIRED' using errcode='42501'; end if;
  if a.version is distinct from (p.input->>'expectedVersion')::integer then raise exception 'RECORD_CHANGED'; end if;
  if p.input ? 'ownerId' then
   select * into recipient from public.utenti where id=(p.input->>'ownerId')::uuid and attivo is not false;
   if not found or not public.workspace_module_enabled_for_user(recipient.id,'anomalie') or not 'anomalie'=any(public.workspace_area_access_codes(recipient.auth_user_id))
    or exists(select 1 from unnest(a.source_modules) m where not public.workspace_module_enabled_for_user(recipient.id,m))
    or (a.department_id is not null and not exists(select 1 from public.utenti_reparti ur where ur.utente_id=recipient.id and ur.reparto_id=a.department_id)) then raise exception 'OWNER_NOT_AUTHORIZED'; end if;
  end if;
  if p.input ? 'taskId' and not exists(select 1 from public.v4_fasi_progetto t where t.id=(p.input->>'taskId')::uuid) then raise exception 'TASK_NOT_ACCESSIBLE'; end if;
  if p.input ? 'taskId' and not public.anomaly_task_accessible((p.input->>'taskId')::uuid) then raise exception 'TASK_NOT_ACCESSIBLE' using errcode='42501'; end if;
  update public.anomalies set status=coalesce(p.input->>'status',status),owner_id=coalesce((p.input->>'ownerId')::uuid,owner_id),
   corrective_proposal=coalesce(p.input->'correctiveProposal',corrective_proposal),task_id=coalesce((p.input->>'taskId')::uuid,task_id) where id=a.id;
  if p.input ? 'comment' then
   if length(btrim(p.input->>'comment')) not between 1 and 4000 then raise exception 'INVALID_COMMENT'; end if;
   insert into public.anomaly_events(anomaly_id,actor_id,kind,body) values(a.id,p.user_id,'comment',p.input->>'comment');
  end if;
 end if;
 update public.second_brain_proposals set status=case when p_confirm then 'executed' else 'rejected' end,
  confirmed_at=now(),result=jsonb_build_object('id',p.input->>'id','changed',p_confirm,'managementOnly',true)
  where id=p_id returning * into p;
 return p;
end $$;
revoke all on function public.anomaly_decide(uuid,boolean) from public,anon;
grant execute on function public.anomaly_decide(uuid,boolean) to authenticated;
create function public.second_brain_decide(p_id uuid,p_confirm boolean) returns public.second_brain_proposals
language plpgsql security invoker set search_path=public as $$
declare p public.second_brain_proposals;
begin
 select * into p from public.second_brain_proposals where id=p_id and user_id=public.workspace_current_profile_id();
 if not found then raise exception 'PROPOSAL_NOT_ACCESSIBLE' using errcode='42501'; end if;
 if p.tool in ('ANOMALY_UPDATE','ANOMALY_CONFIGURE') then return public.anomaly_decide(p_id,p_confirm); end if;
 return public.second_brain_decide_existing(p_id,p_confirm);
end $$;
revoke all on function public.second_brain_decide(uuid,boolean) from public,anon;
grant execute on function public.second_brain_decide(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
-- Narrow service-only ingestion, atomic daily deduplication and history.
create function public.anomaly_record_run(p_day date,p_status text,p_coverage jsonb,p_findings jsonb) returns public.anomaly_runs
language plpgsql security definer set search_path=public as $$
declare r public.anomaly_runs; f jsonb;
begin
 if p_status not in ('complete','incomplete') or jsonb_typeof(p_findings) is distinct from 'array' or jsonb_array_length(p_findings)>10000 then raise exception 'INVALID_RUN'; end if;
 insert into public.anomaly_runs(agent_code,business_day,status,coverage,finished_at)
 values('fabbisogni',p_day,p_status,p_coverage,now()) on conflict(agent_code,business_day) do nothing returning * into r;
 if not found then select * into r from public.anomaly_runs where agent_code='fabbisogni' and business_day=p_day; return r; end if;
 for f in select * from jsonb_array_elements(p_findings) loop
  if f->>'agent_code'<>'fabbisogni' or jsonb_typeof(f->'source_modules') is distinct from 'array' then raise exception 'INVALID_FINDING'; end if;
  insert into public.anomalies(agent_code,fingerprint,category,severity,title,description,department_id,source_modules,evidence,last_run_id)
  values('fabbisogni',f->>'fingerprint',f->>'category',f->>'severity',f->>'title',f->>'description',(f->>'department_id')::uuid,
    array(select jsonb_array_elements_text(f->'source_modules')),f->'evidence',r.id)
  on conflict(agent_code,fingerprint) do update set last_seen_at=now(),last_run_id=r.id,
    evidence=excluded.evidence,severity=excluded.severity,title=excluded.title,description=excluded.description,
    status=case when public.anomalies.status='resolved' then 'open' else public.anomalies.status end;
 end loop;
 return r;
end $$;
revoke all on function public.anomaly_record_run(date,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.anomaly_record_run(date,text,jsonb,jsonb) to service_role;
commit;

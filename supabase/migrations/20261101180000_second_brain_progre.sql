begin;

create table public.second_brain_memory (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.utenti(id),
  scope text not null check(scope in ('personal','department','company')),
  department_id uuid references public.reparti(id),
  project_id uuid references public.v4_progetti(id),
  title text not null check(length(title) between 1 and 200),
  content text not null check(length(content) between 1 and 16000),
  kind text not null check(kind in ('decision','procedure','historical','fact')),
  source text not null check(length(source) between 1 and 2000),
  source_key text not null check(length(source_key) between 1 and 300),
  source_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((scope='department')=(department_id is not null)),
  unique(owner_id,source_key)
);
create index second_brain_memory_search on public.second_brain_memory using gin(to_tsvector('simple',title||' '||content));

create table public.second_brain_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.utenti(id),
  tool text not null check(tool in ('MEMORY_SAVE','ACTIVITY_CREATE','PROJECT_UPDATE','TASK_UPDATE')),
  input jsonb not null,
  before_snapshot jsonb,
  status text not null default 'proposed' check(status in ('proposed','executed','rejected')),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '30 minutes',
  confirmed_at timestamptz
);
create table public.second_brain_calls (
  id uuid primary key,
  user_id uuid not null references public.utenti(id),
  tool text not null,
  status text not null check(status in ('started','completed','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text
);
alter table public.second_brain_memory enable row level security;
alter table public.second_brain_proposals enable row level security;
alter table public.second_brain_calls enable row level security;

-- AI scope supplements, never replaces, the source-system RLS policies.
create or replace function public.second_brain_enabled()
returns boolean language sql stable security invoker set search_path=public as $$
 select coalesce((public.workspace_ai_capabilities()->>'module_access')::boolean,false)
    and coalesce((public.workspace_ai_capabilities()->>'internal_data')::boolean,false)
$$;
create or replace function public.second_brain_department_member(p_department uuid)
returns boolean language sql stable security invoker set search_path=public as $$
 select exists(select 1 from public.utenti_reparti where utente_id=public.workspace_current_profile_id() and reparto_id=p_department)
 or exists(select 1 from public.utenti where id=public.workspace_current_profile_id() and reparto_id=p_department)
$$;

create policy second_brain_memory_read on public.second_brain_memory for select to authenticated using(
 public.second_brain_enabled()
 and (scope='company' or (scope='personal' and owner_id=public.workspace_current_profile_id())
   or (scope='department' and public.second_brain_department_member(department_id)))
 and (project_id is null or exists(select 1 from public.v4_progetti p where p.id=project_id))
);
create policy second_brain_memory_insert on public.second_brain_memory for insert to authenticated with check(
 public.second_brain_enabled() and owner_id=public.workspace_current_profile_id()
 and (scope='personal' or (scope='department' and public.second_brain_department_member(department_id)) or (scope='company' and public.workspace_user_is_admin()))
 and (project_id is null or exists(select 1 from public.v4_progetti p where p.id=project_id))
);
create policy second_brain_memory_update on public.second_brain_memory for update to authenticated
 using(public.second_brain_enabled() and owner_id=public.workspace_current_profile_id())
 with check(public.second_brain_enabled() and owner_id=public.workspace_current_profile_id()
 and (scope='personal' or (scope='department' and public.second_brain_department_member(department_id)) or (scope='company' and public.workspace_user_is_admin()))
 and (project_id is null or exists(select 1 from public.v4_progetti p where p.id=project_id)));
create policy second_brain_proposals_read on public.second_brain_proposals for select to authenticated using(public.second_brain_enabled() and user_id=public.workspace_current_profile_id());
create policy second_brain_proposals_insert on public.second_brain_proposals for insert to authenticated with check(public.second_brain_enabled() and user_id=public.workspace_current_profile_id() and status='proposed');
create policy second_brain_proposals_update on public.second_brain_proposals for update to authenticated using(public.second_brain_enabled() and user_id=public.workspace_current_profile_id()) with check(user_id=public.workspace_current_profile_id());
create policy second_brain_calls_read on public.second_brain_calls for select to authenticated using(user_id=public.workspace_current_profile_id());
grant select,insert,update on public.second_brain_memory,public.second_brain_proposals to authenticated;
grant select on public.second_brain_calls to authenticated;
grant all on public.second_brain_memory,public.second_brain_proposals,public.second_brain_calls to service_role;

create or replace function public.second_brain_propose(p_tool text,p_input jsonb)
returns public.second_brain_proposals language plpgsql security invoker set search_path=public as $$
declare v_user uuid:=public.workspace_current_profile_id(); v_row public.second_brain_proposals; v_before jsonb; v_preview jsonb;
begin
 if not public.second_brain_enabled() or v_user is null then raise exception 'FORBIDDEN'; end if;
 if jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>40000 then raise exception 'INVALID_INPUT'; end if;
 if p_tool not in ('MEMORY_SAVE','ACTIVITY_CREATE','PROJECT_UPDATE','TASK_UPDATE') then raise exception 'TOOL_NOT_ALLOWED'; end if;
 if p_tool<>'MEMORY_SAVE' then
  if not public.workspace_ai_can_propose() or (not public.workspace_user_is_admin() and coalesce(public.workspace_access_context()->'module_levels'->>'attivita','nessuno') not in ('scrittura','amministrazione'))
    or not coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]'::jsonb) ? 'attivita' then raise exception 'FORBIDDEN'; end if;
 end if;
 if p_tool='PROJECT_UPDATE' then
  select to_jsonb(p) into v_before from public.v4_progetti p where id=(p_input->>'id')::uuid;
 elsif p_tool='TASK_UPDATE' then
  select to_jsonb(t) into v_before from public.v4_fasi_progetto t where id=(p_input->>'id')::uuid;
 elsif p_tool='ACTIVITY_CREATE' then
  select to_jsonb(a) into v_before from public.crm_accounts a where id=(p_input->>'accountId')::uuid;
  if v_before is null then raise exception 'ACCOUNT_NOT_ACCESSIBLE'; end if;
  if not exists(select 1 from public.crm_opportunities where id=(p_input->>'opportunityId')::uuid and account_id=(p_input->>'accountId')::uuid) then raise exception 'OPPORTUNITY_NOT_ACCESSIBLE'; end if;
  v_preview:=public.workspace_preview_operational_activity((p_input->>'activityTypeId')::uuid,(p_input->>'deadline')::date,
    nullif(p_input->>'departmentId','')::uuid,nullif(p_input->>'responsibleId','')::uuid,v_before->>'tipo');
  if not coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]'::jsonb) ? public.crm_module_for_type(v_before->>'tipo') then raise exception 'FORBIDDEN'; end if;
  v_before:=jsonb_build_object('account',v_before,'preview',v_preview);
 end if;
 if p_tool in ('PROJECT_UPDATE','TASK_UPDATE') and (v_before is null or (v_before->>'updated_at')::timestamptz is distinct from (p_input->>'expectedUpdatedAt')::timestamptz) then raise exception 'RECORD_CHANGED_OR_NOT_ACCESSIBLE'; end if;
 insert into public.second_brain_proposals(user_id,tool,input,before_snapshot) values(v_user,p_tool,p_input,v_before) returning * into v_row;
 return v_row;
end $$;

create or replace function public.second_brain_decide(p_id uuid,p_confirm boolean)
returns public.second_brain_proposals language plpgsql security invoker set search_path=public as $$
declare v_user uuid:=public.workspace_current_profile_id(); v_row public.second_brain_proposals; v_count integer; v_result jsonb; v_preview jsonb;
begin
 if v_user is null or not public.second_brain_enabled() or p_confirm is null then raise exception 'FORBIDDEN'; end if;
 select * into v_row from public.second_brain_proposals where id=p_id and user_id=v_user for update;
 if not found then raise exception 'PROPOSAL_NOT_ACCESSIBLE'; end if;
 if v_row.status<>'proposed' then return v_row; end if;
 if not p_confirm then update public.second_brain_proposals set status='rejected',result='{"changed":false}' where id=p_id returning * into v_row; return v_row; end if;
 if v_row.expires_at<now() then raise exception 'PROPOSAL_EXPIRED'; end if;
 if v_row.tool<>'MEMORY_SAVE' then
  if not public.workspace_ai_can_confirm() or (not public.workspace_user_is_admin() and coalesce(public.workspace_access_context()->'module_levels'->>'attivita','nessuno') not in ('scrittura','amministrazione'))
    or not coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]'::jsonb) ? 'attivita' then raise exception 'FORBIDDEN'; end if;
 end if;
 if v_row.tool='MEMORY_SAVE' then
  insert into public.second_brain_memory(owner_id,scope,department_id,project_id,title,content,kind,source,source_key,source_date)
  values(v_user,v_row.input->>'scope',nullif(v_row.input->>'departmentId','')::uuid,nullif(v_row.input->>'projectId','')::uuid,
    v_row.input->>'title',v_row.input->>'content',v_row.input->>'kind',v_row.input->>'source',v_row.input->>'sourceKey',nullif(v_row.input->>'sourceDate','')::timestamptz)
  on conflict(owner_id,source_key) do update set title=excluded.title,content=excluded.content,kind=excluded.kind,source=excluded.source,
    source_date=excluded.source_date,scope=excluded.scope,department_id=excluded.department_id,project_id=excluded.project_id,updated_at=now()
  returning jsonb_build_object('memoryId',id,'scope',scope,'changed',true) into v_result;
 elsif v_row.tool='PROJECT_UPDATE' then
  update public.v4_progetti set titolo=coalesce(v_row.input->>'title',titolo),descrizione=case when v_row.input ? 'description' then v_row.input->>'description' else descrizione end,
    deadline=case when v_row.input ? 'deadline' then (v_row.input->>'deadline')::date else deadline end,modificato_da=v_user,updated_at=now()
    where id=(v_row.input->>'id')::uuid and updated_at=(v_row.input->>'expectedUpdatedAt')::timestamptz;
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'RECORD_CHANGED_OR_NOT_WRITABLE'; end if;
  v_result:=jsonb_build_object('id',v_row.input->>'id','changed',true,'taskDeadlinesRecalculated',false);
 elsif v_row.tool='TASK_UPDATE' then
  update public.v4_fasi_progetto set descrizione=case when v_row.input ? 'description' then v_row.input->>'description' else descrizione end,
    deadline=case when v_row.input ? 'deadline' then (v_row.input->>'deadline')::date else deadline end,modificato_da=v_user,updated_at=now()
    where id=(v_row.input->>'id')::uuid and updated_at=(v_row.input->>'expectedUpdatedAt')::timestamptz;
  get diagnostics v_count=row_count;
  if v_count<>1 then raise exception 'RECORD_CHANGED_OR_NOT_WRITABLE'; end if;
  v_result:=jsonb_build_object('id',v_row.input->>'id','changed',true);
 elsif v_row.tool='ACTIVITY_CREATE' then
  v_preview:=public.workspace_preview_operational_activity((v_row.input->>'activityTypeId')::uuid,(v_row.input->>'deadline')::date,
    nullif(v_row.input->>'departmentId','')::uuid,nullif(v_row.input->>'responsibleId','')::uuid,v_row.before_snapshot->'account'->>'tipo');
  if not coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]'::jsonb) ? public.crm_module_for_type(v_row.before_snapshot->'account'->>'tipo') then raise exception 'FORBIDDEN'; end if;
  if v_preview is distinct from v_row.before_snapshot->'preview' then raise exception 'ACTIVITY_WORKFLOW_CHANGED'; end if;
  v_result:=public.workspace_create_operational_activity((v_row.input->>'accountId')::uuid,(v_row.input->>'opportunityId')::uuid,
   (v_row.input->>'activityTypeId')::uuid,v_row.input->>'title',v_row.input->>'description',(v_row.input->>'deadline')::date,
   nullif(v_row.input->>'departmentId','')::uuid,nullif(v_row.input->>'responsibleId','')::uuid,'second-brain:'||v_row.id::text);
 end if;
 update public.second_brain_proposals set status='executed',confirmed_at=now(),result=v_result where id=p_id returning * into v_row;
 return v_row;
end $$;
create or replace function public.second_brain_import_history(p_entries jsonb)
returns integer language plpgsql security invoker set search_path=public as $$
declare v_entry jsonb; v_proposal public.second_brain_proposals; v_count integer:=0;
begin
 if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 20 or octet_length(p_entries::text)>90000 then raise exception 'INVALID_IMPORT_BATCH'; end if;
 for v_entry in select value from jsonb_array_elements(p_entries) loop
  if v_entry->>'scope' is distinct from 'personal' or v_entry->>'kind' is distinct from 'historical' or v_entry ? 'departmentId' or v_entry ? 'projectId' then raise exception 'PERSONAL_HISTORY_ONLY'; end if;
  select * into v_proposal from public.second_brain_propose('MEMORY_SAVE',v_entry);
  perform public.second_brain_decide(v_proposal.id,true);
  v_count:=v_count+1;
 end loop;
 return v_count;
end $$;
revoke all on function public.second_brain_enabled(),public.second_brain_department_member(uuid),public.second_brain_propose(text,jsonb),public.second_brain_decide(uuid,boolean),public.second_brain_import_history(jsonb) from public,anon;
grant execute on function public.second_brain_enabled(),public.second_brain_department_member(uuid),public.second_brain_propose(text,jsonb),public.second_brain_decide(uuid,boolean),public.second_brain_import_history(jsonb) to authenticated;
commit;

begin;
insert into public.ai_action_registry(code,system,risk_level,input_schema,required_permission,active)
values('PRODUCTION_OBJECTIVE_RECALCULATE','mes','write','{"type":"object"}'::jsonb,'progremes.write',true)
on conflict(code) do update set input_schema=excluded.input_schema,active=true,updated_at=now();

create unique index if not exists production_objective_action_order
on public.production_cost_adjustments((details->>'objectiveActionId'),mes_order_id)
where details ? 'objectiveActionId';

-- Backend only. The browser must first confirm its own durable Workspace audit.
-- This transaction appends versions and backup copies; it never updates source
-- documents, prices, durations, MES snapshots or original configurations.
create or replace function public.production_objective_apply_revision(p_action uuid,p_user uuid)
returns public.ai_action_audit language plpgsql security invoker set search_path=public as $$
declare a public.ai_action_audit; item jsonb; r public.production_cost_records;
 cfg jsonb; ids jsonb; items jsonb; expected_id uuid; n integer:=0;
begin
 if current_user not in ('postgres','service_role') then raise exception 'FORBIDDEN'; end if;
 select * into a from public.ai_action_audit where id=p_action and user_id=p_user for update;
 if a.id is null or a.tool<>'PRODUCTION_OBJECTIVE_RECALCULATE' then raise exception 'ACTION_NOT_FOUND'; end if;
 if not exists(select 1 from public.utenti u join public.ruoli role on role.id=u.ruolo_id
   where u.id=p_user and u.attivo is true and (role.amministratore_workspace or role.livello_ai='conferma')) then raise exception 'FORBIDDEN'; end if;
 if coalesce(public.workspace_screen_level_for_user(p_user,'produzione.consuntivi'),'nessuno')
   not in ('scrittura','gestione','completo','amministrazione') then raise exception 'FORBIDDEN'; end if;
 if a.status='executed' then return a; end if;
 if a.status<>'confirmed' or a.confirmed_at is null then raise exception 'HUMAN_CONFIRMATION_REQUIRED'; end if;
 items:=a.payload_summary->'preview'->'items';
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items)=0 then raise exception 'EMPTY_PREVIEW'; end if;
 -- Prevent an import/configuration/adjustment racing the compare-and-append.
 lock table public.production_cost_records in share mode;
 lock table public.production_cost_configurations in share mode;
 lock table public.production_cost_adjustments in share row exclusive mode;
 for item in select value from jsonb_array_elements(items) loop
  select * into r from public.production_cost_records where mes_order_id=(item->>'id')::integer;
  if r.mes_order_id is null or r.evidence is distinct from item->'expectedEvidence' then raise exception 'EVIDENCE_CHANGED'; end if;
  if r.configuration_id is distinct from nullif(item->>'expectedAssignedConfigurationId','')::uuid then raise exception 'ASSIGNED_CONFIGURATION_CHANGED'; end if;
  expected_id:=nullif(item->>'configurationId','')::uuid;
  select to_jsonb(c) into cfg from public.production_cost_configurations c where id=expected_id;
  if coalesce(cfg,'null'::jsonb) is distinct from item->'expectedConfiguration' then raise exception 'CONFIGURATION_CHANGED'; end if;
  select coalesce(jsonb_agg(id::text order by id::text),'[]'::jsonb) into ids
    from public.production_cost_adjustments where mes_order_id=r.mes_order_id;
  if ids is distinct from item->'expectedAdjustmentIds' then raise exception 'ADJUSTMENTS_CHANGED'; end if;
  if item->'backup'->'evidence' is distinct from r.evidence
    or item->'backup'->'configuration' is distinct from coalesce(cfg,'null'::jsonb)
    or item->'backup'->'previousVersion' is distinct from item->'before' then raise exception 'BACKUP_NOT_VERIFIED'; end if;
  insert into public.production_cost_adjustments(mes_order_id,details,reason,created_by)
   values(r.mes_order_id,jsonb_build_object('objectiveActionId',a.id,'objectiveRevision',item->'after',
    'objectiveBackup',item->'backup','objectiveSourceSnapshot',a.payload_summary->>'expectedSnapshot',
    'objectiveRollbackOf',a.payload_summary->>'rollbackOf'),a.payload_summary->>'reason',p_user);
  n:=n+1;
 end loop;
 update public.ai_action_audit set before_snapshot=a.payload_summary->'preview',status='executed',executed_at=now(),
  result=jsonb_build_object('applied',true,'verified',true,'versionsCreated',n,'originalSnapshotsChanged',false,
   'pricesChanged',false,'durationsChanged',false,'rollbackOf',a.payload_summary->>'rollbackOf') where id=a.id returning * into a;
 return a;
end $$;
revoke all on function public.production_objective_apply_revision(uuid,uuid) from public,anon,authenticated;
grant execute on function public.production_objective_apply_revision(uuid,uuid) to service_role;

create or replace function public.production_objective_preserve_version() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if old.details ? 'objectiveActionId' then raise exception 'OBJECTIVE_VERSION_IMMUTABLE'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger production_objective_immutable before update or delete on public.production_cost_adjustments
for each row execute function public.production_objective_preserve_version();
commit;

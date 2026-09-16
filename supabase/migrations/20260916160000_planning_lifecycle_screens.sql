begin;
insert into public.workspace_schermate(codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,aree,icona)
values
('produzione.versioni_piano','Versioni e revisioni del piano','Previsioni RdP, confronto delle versioni, conferma del piano e migrazione controllata.','workspace','/versioni-piano-produzione','PlanningVersions',false,true,440,'produzione',array['produzione'],'calendar-clock'),
('produzione.rilascio_odl','Rilascio ODL','Rilascio delle fasi produttive: copertura materiali, lotti e congelamento operativo.','workspace','/rilascio-odl','PlanningRelease',false,true,450,'produzione',array['produzione'],'clipboard-check')
on conflict(codice) do update set percorso=excluded.percorso,chiave_componente=excluded.chiave_componente;
insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values ('progremes','produzione.versioni_piano',440,false,true),('progremes','produzione.rilascio_odl',450,false,true) on conflict do nothing;
insert into public.ai_action_registry(code,system,risk_level,input_schema,required_permission,active)
values ('MES_PLAN_APPLY','mes','destructive','{"type":"object","required":["targetId","expectedHash","evidence"]}'::jsonb,'progremes.write',true),
('MES_ODL_VERIFY','mes','write','{"type":"object","required":["targetId","expectedHash","evidence"]}'::jsonb,'progremes.write',true)
on conflict(code) do update set input_schema=excluded.input_schema,active=true;

-- Separate function: the legacy confirmation remains unchanged until explicit activation in MES.
create or replace function public.confirm_workspace_forecast_after_mes(
 p_preview_id bigint,p_external_id uuid,p_idempotency_key text,p_payload_hash text,p_expected_row_version integer,
 p_decision text,p_mes_response jsonb,p_actor text,p_reason text,p_correlation_id uuid,p_causation_id uuid
) returns setof public.workspace_v4_confirmation_mirrors language plpgsql security definer set search_path=public as $$
declare v_preview public.workspace_v4_previews%rowtype; v_confirmation public.workspace_v4_confirmation_mirrors%rowtype;
begin
 if not coalesce((select enabled from public.workspace_v4_feature_flags where key='workspacemes.v4.confirm'),false) then raise exception 'WORKSPACEMES_V4_CONFIRM_DISABLED'; end if;
 if p_mes_response->>'status' is distinct from 'FORECAST' or p_mes_response->>'productionCreated' is distinct from 'false'
    or jsonb_array_length(coalesce(p_mes_response->'forecastLines','[]'::jsonb))=0 then raise exception 'INVALID_FORECAST_RESPONSE'; end if;
 select * into v_confirmation from public.workspace_v4_confirmation_mirrors where idempotency_key=p_idempotency_key;
 if found then
   if v_confirmation.payload_hash is distinct from p_payload_hash then raise exception 'V4_IDEMPOTENCY_CONFLICT'; end if;
   return next v_confirmation; return;
 end if;
 select * into v_preview from public.workspace_v4_previews where id=p_preview_id for update;
 if not found or v_preview.local_row_version<>p_expected_row_version or v_preview.status<>'READY' then raise exception 'STALE_V4_PREVIEW'; end if;
 insert into public.workspace_v4_confirmation_mirrors(external_id,preview_id,idempotency_key,payload_hash,decision,status,mes_response,actor,reason,correlation_id,causation_id)
 values(p_external_id,p_preview_id,p_idempotency_key,p_payload_hash,upper(p_decision),'FORECAST',p_mes_response,p_actor,p_reason,p_correlation_id,p_causation_id)
 returning * into v_confirmation;
 update public.workspace_v4_previews set status='CONFIRMED',confirmed_at=now(),local_row_version=local_row_version+1 where id=p_preview_id;
 update public.workspace_production_requests set stato='CONFIRMED',workspace_status='CONFIRMED',last_error_code=null,last_response=p_mes_response,updated_at=now() where id=v_preview.production_request_id;
 -- Intentionally no purchase requirement, OP, material reservation or lot at RdP confirmation.
 return next v_confirmation;
end $$;
revoke all on function public.confirm_workspace_forecast_after_mes(bigint,uuid,text,text,integer,text,jsonb,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_workspace_forecast_after_mes(bigint,uuid,text,text,integer,text,jsonb,text,text,uuid,uuid) to service_role;

create table if not exists public.workspace_planning_mirrors (
 version_id uuid primary key, payload jsonb not null, actor uuid not null, recorded_at timestamptz not null default now()
);
alter table public.workspace_planning_mirrors enable row level security;
revoke all on public.workspace_planning_mirrors from anon,authenticated;
grant all on public.workspace_planning_mirrors to service_role;

create or replace function public.reconcile_workspace_planning(p_state jsonb,p_actor uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_group record; v_orders jsonb; v_response jsonb; v_applied timestamptz;
begin
 v_id := (p_state#>>'{configuration,activeVersionId}')::uuid;
 if v_id is null or jsonb_typeof(p_state->'demands') is distinct from 'array' then raise exception 'INVALID_MES_PLANNING_STATE'; end if;
 perform pg_advisory_xact_lock(hashtext('workspace-planning-mirror'));
 v_applied := (p_state->>'activeVersionAppliedAtUtc')::timestamptz;
 if v_applied is null then raise exception 'MISSING_PLANNING_VERSION_TIME'; end if;
 if exists(select 1 from public.workspace_planning_mirrors where (payload->>'activeVersionAppliedAtUtc')::timestamptz > v_applied) then return; end if;
 if exists(select 1 from public.workspace_planning_mirrors where version_id=v_id) then return; end if;
 for v_group in
   select m.id,m.preview_id,m.status,m.mes_response,jsonb_agg(d.value) as demands
   from jsonb_array_elements(p_state->'demands') d
   join public.workspace_v4_confirmation_mirrors m on m.external_id=(d.value->>'confirmationExternalId')::uuid
   group by m.id,m.preview_id,m.status,m.mes_response
 loop
   if v_group.status='CANCELLED' then continue; end if;
   select coalesce(jsonb_agg(jsonb_build_object('id',(d->>'productionOrderId')::integer,'number',d->>'number',
      'articleCode',d->>'articleCode','quantity',(d->>'quantity')::numeric,'requiredAt',d->>'requestedAt',
      'estimatedAt',d->>'estimatedAt','confirmedDeliveryAt',d->>'confirmedDeliveryAt')),'[]'::jsonb)
   into v_orders from jsonb_array_elements(v_group.demands) d
   where d->>'productionOrderId' is not null and d->>'stage'<>'CANCELLED';
   v_response := v_group.mes_response || jsonb_build_object('productionOrders',v_orders,'productionCreated',jsonb_array_length(v_orders)>0,
      'planningVersionId',v_id,'planningDemands',v_group.demands,
      'status',case when jsonb_array_length(v_orders)>0 then 'COMPLETED' else 'FORECAST' end);
   update public.workspace_v4_confirmation_mirrors set mes_response=v_response,status=v_response->>'status' where id=v_group.id;
   update public.workspace_production_requests r set last_response=v_response,updated_at=now()
   from public.workspace_v4_previews p where p.id=v_group.preview_id and r.id=p.production_request_id and r.stato<>'CANCELLED';
 end loop;
 insert into public.workspace_planning_mirrors(version_id,payload,actor) values(v_id,p_state,p_actor);
end $$;
revoke all on function public.reconcile_workspace_planning(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_workspace_planning(jsonb,uuid) to service_role;
-- Manual UI keeps the same durable audit, but requires operational MES permission only.
-- It cannot propose/confirm other tools or AI-originated proposals.
create or replace function public.propose_workspace_manual_planning_action(p_tool text,p_payload jsonb,p_request_id uuid,p_correlation_id uuid,p_idempotency_key text)
returns public.ai_action_audit language plpgsql security definer set search_path=public as $$
declare v_user uuid:=public.workspace_current_profile_id(); v_row public.ai_action_audit;
begin
 if v_user is null or not public.company_mes_ai_can_write() then raise exception 'FORBIDDEN'; end if;
 if p_tool not in ('MES_PLAN_APPLY','MES_ODL_VERIFY') or not exists(select 1 from public.ai_action_registry where code=p_tool and active) then raise exception 'TOOL_NOT_ALLOWED'; end if;
 if nullif(p_payload->>'targetId','') is null or nullif(p_payload->>'expectedHash','') is null then raise exception 'INVALID_PLANNING_EVIDENCE'; end if;
 insert into public.ai_action_audit(user_id,system,tool,action,target,payload_summary,status,request_id,correlation_id,idempotency_key)
 values(v_user,'mes',p_tool,'manual_planning',p_payload->>'targetId',p_payload,'proposed',p_request_id,p_correlation_id,'manual:'||p_idempotency_key)
 on conflict(user_id,tool,idempotency_key) where idempotency_key is not null do update set occurred_at=public.ai_action_audit.occurred_at
 returning * into v_row; return v_row;
end $$;
create or replace function public.decide_workspace_manual_planning_action(p_proposal_id uuid,p_confirm boolean)
returns public.ai_action_audit language plpgsql security definer set search_path=public as $$
declare v_user uuid:=public.workspace_current_profile_id(); v_row public.ai_action_audit;
begin
 if v_user is null or not public.company_mes_ai_can_write() then raise exception 'FORBIDDEN'; end if;
 select * into v_row from public.ai_action_audit where id=p_proposal_id and user_id=v_user for update;
 if v_row.id is null or v_row.action<>'manual_planning' or v_row.tool not in ('MES_PLAN_APPLY','MES_ODL_VERIFY') then raise exception 'FORBIDDEN'; end if;
 if v_row.status in ('executed','failed','rejected','rolled_back') then return v_row; end if;
 if v_row.status<>'proposed' then raise exception 'INVALID_STATE'; end if;
 update public.ai_action_audit set status=case when p_confirm then 'confirmed' else 'rejected' end,
 confirmed_at=case when p_confirm then now() else null end where id=v_row.id returning * into v_row;
 return v_row;
end $$;
revoke all on function public.propose_workspace_manual_planning_action(text,jsonb,uuid,uuid,text) from public,anon;
revoke all on function public.decide_workspace_manual_planning_action(uuid,boolean) from public,anon;
grant execute on function public.propose_workspace_manual_planning_action(text,jsonb,uuid,uuid,text) to authenticated;
grant execute on function public.decide_workspace_manual_planning_action(uuid,boolean) to authenticated;
commit;

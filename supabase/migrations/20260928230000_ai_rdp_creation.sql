begin;
insert into public.ai_action_registry(code,system,risk_level,input_schema,required_permission,active)
values ('RDP_CREATE','mes','write','{"type":"object","required":["targetId","reason"]}'::jsonb,'rdp.create',true)
on conflict(code) do update set input_schema=excluded.input_schema,required_permission=excluded.required_permission,active=true;

-- Cancelled history remains immutable; active requests and pending cancellation block reuse.
create or replace function public.check_ai_rdp_demand_available(p_snapshot jsonb,p_idempotency_key text default null)
returns void language plpgsql security definer set search_path=public as $$
declare conflict_id uuid;
begin
 if jsonb_typeof(p_snapshot->'items') is distinct from 'array' or jsonb_array_length(p_snapshot->'items')=0 then raise exception 'EMPTY_SELECTION'; end if;
 select r.id into conflict_id from public.workspace_production_requests r
 where (exists(select 1 from public.workspace_production_request_items i
   join jsonb_array_elements(p_snapshot->'items') x on i.ordine_riga_id=(x->>'lineId')::uuid
   where i.production_request_id=r.id)
   or exists(select 1 from jsonb_array_elements(p_snapshot->'items') x where r.ordine_riga_id=(x->>'lineId')::uuid))
 and (exists(select 1 from public.workspace_rdp_cancellations c where c.request_id=r.id and c.status='PREPARED')
   or (upper(coalesce(r.workspace_status,r.stato,''))<>'CANCELLED' and r.idempotency_key is distinct from p_idempotency_key))
 limit 1;
 if conflict_id is not null then raise exception 'RDP_ALREADY_ACTIVE: riga OC già associata a RdP attiva o in annullamento (%)',conflict_id; end if;
end $$;

create or replace function public.record_ai_workspace_production_demand(
 p_create_request boolean,p_idempotency_key text,p_demand_hash text,p_snapshot_hash text,p_snapshot jsonb,p_requested_by uuid default null
) returns table(request_id uuid,external_id uuid,snapshot_id bigint,snapshot_hash text,snapshot_captured_at timestamptz,reused boolean,attempt_count integer)
language plpgsql security definer set search_path=public as $$
begin
 if not coalesce(p_create_request,false) or p_requested_by is null or
   p_snapshot->>'requestedBy' is distinct from p_requested_by::text then raise exception 'INVALID_AI_RDP_ACTOR'; end if;
 -- Serialize simultaneous assistant requests, including overlapping selections.
 perform 1 from public.ordini_righe l where l.id in
   (select (x->>'lineId')::uuid from jsonb_array_elements(p_snapshot->'items') x) order by l.id for update;
 if exists(select 1 from jsonb_array_elements(p_snapshot->'items') x
   left join public.ordini_righe l on l.id=(x->>'lineId')::uuid
   left join public.ordini_testate o on o.id=l.ordine_id
   where l.id is null or l.mexal_attiva=false or coalesce(l.riga_descrittiva,false)
     or upper(btrim(l.codice_articolo)) is distinct from x->>'commercialArticleCode'
     or l.quantita is distinct from (x->>'requestedQuantity')::numeric
     or o.origine is distinct from 'mexal_oct' or o.mexal_eliminato_il is not null) then
   raise exception 'RDP_SOURCE_CHANGED: righe OC cambiate, ricalcolare anteprima';
 end if;
 perform public.check_ai_rdp_demand_available(p_snapshot,p_idempotency_key);
 if exists(select 1 from public.workspace_production_requests r where r.idempotency_key=p_idempotency_key
   and upper(coalesce(r.workspace_status,r.stato,''))='CANCELLED') then raise exception 'RDP_PREVIEW_REFRESH_REQUIRED'; end if;
 return query select * from public.record_workspace_production_demand(p_create_request,p_idempotency_key,p_demand_hash,p_snapshot_hash,p_snapshot,p_requested_by);
end $$;

revoke all on function public.check_ai_rdp_demand_available(jsonb,text) from public,anon,authenticated;
revoke all on function public.record_ai_workspace_production_demand(boolean,text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.check_ai_rdp_demand_available(jsonb,text) to service_role;
grant execute on function public.record_ai_workspace_production_demand(boolean,text,text,text,jsonb,uuid) to service_role;
commit;

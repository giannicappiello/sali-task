begin;

-- The legacy path still refuses any confirmed proposal, OP, lot or movement.
-- A request status alone is not an irreversible effect.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.cancel_workspace_production_request(uuid,text,uuid)'::regprocedure);
 if position('''AWAITINGDECISION'', ''AWAITING_DECISION''' in definition)=0 then raise exception 'Unexpected legacy cancellation definition'; end if;
 execute replace(definition,'''AWAITINGDECISION'', ''AWAITING_DECISION''',
   '''AWAITINGDECISION'', ''AWAITING_DECISION'', ''CONFIRMED'', ''PLANNED'', ''RECEIVED'', ''SENT'', ''DRAFT'', ''FORECAST''');
end $$;

-- Intent is durable across HTTP timeouts. No business row is deleted.
create table public.workspace_rdp_cancellations (
 request_id uuid primary key references public.workspace_production_requests(id),
 external_id uuid not null, confirmations uuid[] not null default '{}',
 previous_status text not null, reason text not null, actor_id uuid,
 status text not null default 'PREPARED' check(status in ('PREPARED','COMPLETED')),
 created_at timestamptz not null default now(), completed_at timestamptz
);
alter table public.workspace_rdp_cancellations enable row level security;
revoke all on public.workspace_rdp_cancellations from public,anon,authenticated;
grant all on public.workspace_rdp_cancellations to service_role;

create or replace function public.prepare_workspace_rdp_cancellation(p_request_id uuid,p_reason text,p_cancelled_by uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.workspace_production_requests%rowtype; c public.workspace_rdp_cancellations%rowtype;
 s text; ids uuid[]; legacy record;
begin
 if length(btrim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'INVALID_REASON: motivo da 5 a 1000 caratteri obbligatorio'; end if;
 select * into r from public.workspace_production_requests where id=p_request_id for update;
 if not found then raise exception 'NOT_FOUND: RdP non trovata'; end if;
 select * into c from public.workspace_rdp_cancellations where request_id=p_request_id;
 if found then return to_jsonb(c); end if;
 s:=upper(coalesce(r.workspace_status,r.stato,''));
 if s='CANCELLED' then return jsonb_build_object('status','COMPLETED','external_id',r.external_id,'cancelled_at',r.cancelled_at); end if;
 if r.contract_version is distinct from 4 then
   select * into legacy from public.cancel_workspace_production_request(p_request_id,p_reason,p_cancelled_by);
   return jsonb_build_object('status','COMPLETED','external_id',legacy.external_id,'cancelled_at',legacy.cancelled_at);
 end if;
 if s not in ('BLOCKED','FAILED','REJECTED','NON_INVIATA','PRONTA','READY','AWAITINGDECISION','AWAITING_DECISION','CONFIRMED','PLANNED','RECEIVED','SENT','DRAFT','FORECAST') then
   raise exception 'INVALID_STATUS: lavorazione avviata o conclusa; usare una revisione compensativa';
 end if;
 -- Lock every preview, not only the latest (a recalculation can leave older confirmations).
 perform 1 from public.workspace_v4_previews where production_request_id=p_request_id order by id for update;
 select coalesce(array_agg(m.external_id order by m.id),'{}'::uuid[]) into ids
 from public.workspace_v4_confirmation_mirrors m join public.workspace_v4_previews p on p.id=m.preview_id
 where p.production_request_id=p_request_id and upper(m.status)<>'REPLACED';
 if cardinality(ids)=0 and (s in ('CONFIRMED','PLANNED','FORECAST')
    or exists(select 1 from public.workspace_v4_previews where production_request_id=p_request_id and status='CONFIRMED')) then
   raise exception 'MES_CONFIRMATION_MISSING: conferma MES da riconciliare prima dell''annullamento';
 end if;
 -- Never mistake a legacy OP associated with a V4 request for a local-only draft.
 if cardinality(ids)=0 and (exists(select 1 from public.workspace_production_proposals where production_request_id=p_request_id
      and (confirmation_external_id is not null or mes_production_order_id is not null))
    or exists(select 1 from public.workspace_production_event_inbox where external_id=r.external_id
      and event_type ~* '(PRODUCTION.?ORDER.*(CREATED|CONFIRMED)|PLANNING.*(CREATED|CONFIRMED)|LOT.*CREATED|MATERIAL.*(CONSUMED|MOVEMENT)|STOCK.*MOVEMENT|INVENTORY.*MOVEMENT|(LOAD|UNLOAD).*CREATED)')) then
   raise exception 'IRREVERSIBLE_EFFECTS: effetti MES senza conferma V4 riconciliabile';
 end if;
 insert into public.workspace_rdp_cancellations(request_id,external_id,confirmations,previous_status,reason,actor_id)
 values(p_request_id,r.external_id,ids,s,btrim(p_reason),p_cancelled_by) returning * into c;
 return to_jsonb(c);
end $$;

create or replace function public.complete_workspace_rdp_cancellation(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.workspace_production_requests%rowtype; c public.workspace_rdp_cancellations%rowtype;
 warnings jsonb := '[]'::jsonb;
begin
 select * into r from public.workspace_production_requests where id=p_request_id for update;
 select * into c from public.workspace_rdp_cancellations where request_id=p_request_id for update;
 if not found then raise exception 'CANCELLATION_NOT_PREPARED'; end if;
 if c.status='COMPLETED' then return to_jsonb(c)||jsonb_build_object('cancelled_at',c.completed_at); end if;
 if exists(select 1 from public.workspace_v4_confirmation_mirrors m join public.workspace_v4_previews p on p.id=m.preview_id
   where p.production_request_id=p_request_id and upper(m.status) not in ('CANCELLED','REPLACED') and not(m.external_id=any(c.confirmations))) then
   raise exception 'CANCELLATION_CONFLICT: conferme cambiate, riconciliare con MES';
 end if;
 -- Keep supplier documents and their requirements intact; annotate their cancelled source.
 update public.workspace_v4_purchase_requirements q set lineage=q.lineage||jsonb_build_object('rdpCancelledAt',now(),'cancelledRdp',r.external_id),updated_at=now()
 from public.workspace_v4_confirmation_mirrors m where q.confirmation_id=m.id and m.external_id=any(c.confirmations);
 update public.workspace_v4_purchase_requirements q set status='CANCELLED',updated_at=now()
 from public.workspace_v4_confirmation_mirrors m where q.confirmation_id=m.id and m.external_id=any(c.confirmations) and q.status='OPEN'
 and not exists(select 1 from public.workspace_v4_purchase_document_lines l where l.requirement_id=q.id);
 if exists(select 1 from public.workspace_v4_purchase_requirements q join public.workspace_v4_confirmation_mirrors m on m.id=q.confirmation_id
    where m.external_id=any(c.confirmations) and q.status<>'CANCELLED') then
   warnings:=jsonb_build_array('Acquisti già documentati conservati: verificare i fabbisogni collegati alla RdP annullata.');
 end if;
 update public.workspace_v4_confirmation_mirrors set status='CANCELLED',
   mes_response=mes_response||jsonb_build_object('status','CANCELLED','cancelledAt',now()) where external_id=any(c.confirmations);
 update public.workspace_v4_previews set status='CANCELLED',local_row_version=local_row_version+1 where production_request_id=p_request_id;
 update public.workspace_production_requests set stato='Cancelled',workspace_status='Cancelled',cancellation_reason=c.reason,
   cancelled_by=c.actor_id,cancelled_at=now(),updated_at=now() where id=p_request_id returning * into r;
 insert into public.workspace_production_request_audit(production_request_id,action,previous_status,new_status,reason,actor_id,details)
 values(p_request_id,'CANCEL',c.previous_status,'Cancelled',c.reason,c.actor_id,jsonb_build_object('mesConfirmations',c.confirmations,'warnings',warnings));
 update public.workspace_rdp_cancellations set status='COMPLETED',completed_at=r.cancelled_at where request_id=p_request_id returning * into c;
 return to_jsonb(c)||jsonb_build_object('cancelled_at',r.cancelled_at,'warnings',warnings);
end $$;

-- A pending cancellation freezes new previews/confirmations, including direct RPC callers.
create or replace function public.guard_workspace_rdp_cancellation()
returns trigger language plpgsql set search_path=public as $$
declare v_request_id uuid;
begin
 if tg_table_name='workspace_v4_previews' then v_request_id:=new.production_request_id;
 else select production_request_id into v_request_id from public.workspace_v4_previews where id=new.preview_id; end if;
 if upper(new.status)<>'CANCELLED' and exists(select 1 from public.workspace_rdp_cancellations c where c.request_id=v_request_id) then
   raise exception 'RDP_CANCELLATION_PENDING: RdP in annullamento o già annullata';
 end if;
 return new;
end $$;
create trigger guard_rdp_cancellation_preview before insert or update of status on public.workspace_v4_previews
for each row execute function public.guard_workspace_rdp_cancellation();
create trigger guard_rdp_cancellation_mirror before insert or update of status on public.workspace_v4_confirmation_mirrors
for each row execute function public.guard_workspace_rdp_cancellation();

-- Delayed callbacks must not resurrect retired requests.
create or replace function public.preserve_cancelled_workspace_rdp()
returns trigger language plpgsql set search_path=public as $$
begin
 if upper(coalesce(old.workspace_status,old.stato,''))='CANCELLED' then
   new.workspace_status:=old.workspace_status; new.stato:=old.stato;
 elsif upper(coalesce(new.workspace_status,new.stato,''))<>'CANCELLED'
   and (new.workspace_status is distinct from old.workspace_status or new.stato is distinct from old.stato)
   and exists(select 1 from public.workspace_rdp_cancellations where request_id=old.id) then
   raise exception 'RDP_CANCELLATION_PENDING: annullamento in riconciliazione';
 end if;
 return new;
end $$;
create trigger preserve_cancelled_workspace_rdp before update of workspace_status,stato on public.workspace_production_requests
for each row execute function public.preserve_cancelled_workspace_rdp();

revoke all on function public.prepare_workspace_rdp_cancellation(uuid,text,uuid), public.complete_workspace_rdp_cancellation(uuid),
 public.guard_workspace_rdp_cancellation(), public.preserve_cancelled_workspace_rdp() from public,anon,authenticated;
grant execute on function public.prepare_workspace_rdp_cancellation(uuid,text,uuid), public.complete_workspace_rdp_cancellation(uuid) to service_role;
commit;

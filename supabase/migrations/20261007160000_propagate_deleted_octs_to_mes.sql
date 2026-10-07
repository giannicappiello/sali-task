begin;
alter table public.ordini_testate add column if not exists mexal_mes_eliminato_il timestamptz;
alter table public.ordini_testate add column if not exists mexal_mes_eliminazione_errore text;
create table public.workspace_oct_deletions (
  order_id uuid primary key references public.ordini_testate(id),
  generation uuid not null default gen_random_uuid(),
  deleted_at timestamptz not null,
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','COMPLETED','SUPERSEDED')),
  last_error text, mes_response jsonb, completed_at timestamptz,
  attempts integer not null default 0
);
alter table public.workspace_oct_deletions enable row level security;
revoke all on public.workspace_oct_deletions from public,anon,authenticated;
grant all on public.workspace_oct_deletions to service_role;

create function public.queue_deleted_oct() returns trigger language plpgsql security definer set search_path=public as $$
declare body jsonb;
begin
  if new.mexal_eliminato_il is null then
    update public.workspace_oct_deletions set status='SUPERSEDED' where order_id=new.id and status='PENDING';
    new.mexal_mes_eliminato_il:=null;
    new.mexal_mes_eliminazione_errore:=null;
    return new;
  end if;
  if old.mexal_eliminato_il is not distinct from new.mexal_eliminato_il then return new; end if;
  body:=jsonb_build_object('contractVersion',4,'workspaceOctId',new.id,
    'octReference',concat(new.mexal_sigla,'/',new.mexal_serie,'/',new.mexal_numero),
    'deletedAt',new.mexal_eliminato_il,'sourceYear',coalesce(new.mexal_anno,extract(year from new.data_ordine)::int),
    'workspaceLineIds',coalesce((select jsonb_agg(id order by id) from public.ordini_righe where ordine_id=new.id),'[]'::jsonb),
    'rdpExternalIds',coalesce((select jsonb_agg(distinct r.external_id) from public.workspace_production_requests r
      where r.ordine_id=new.id or exists(select 1 from public.workspace_production_request_items i where i.production_request_id=r.id and i.ordine_id=new.id)),'[]'::jsonb));
  insert into public.workspace_oct_deletions(order_id,deleted_at,payload) values(new.id,new.mexal_eliminato_il,body)
  on conflict(order_id) do update set generation=gen_random_uuid(),deleted_at=excluded.deleted_at,payload=excluded.payload,
    status='PENDING',last_error=null,mes_response=null,completed_at=null,attempts=0;
  new.mexal_mes_eliminato_il:=null;
  new.mexal_mes_eliminazione_errore:='Eliminazione ordine e lavorazioni MES in attesa.';
  return new;
end $$;
create trigger queue_deleted_oct before update of mexal_eliminato_il on public.ordini_testate
for each row execute function public.queue_deleted_oct();

-- Include previously retired OCTs with the same confirmed source evidence.
insert into public.workspace_oct_deletions(order_id,deleted_at,payload)
select o.id,o.mexal_eliminato_il,jsonb_build_object('contractVersion',4,'workspaceOctId',o.id,
  'octReference',concat(o.mexal_sigla,'/',o.mexal_serie,'/',o.mexal_numero),'deletedAt',o.mexal_eliminato_il,'sourceYear',coalesce(o.mexal_anno,extract(year from o.data_ordine)::int),
  'workspaceLineIds',coalesce((select jsonb_agg(id order by id) from public.ordini_righe where ordine_id=o.id),'[]'::jsonb),
  'rdpExternalIds',coalesce((select jsonb_agg(distinct r.external_id) from public.workspace_production_requests r
    where r.ordine_id=o.id or exists(select 1 from public.workspace_production_request_items i where i.production_request_id=r.id and i.ordine_id=o.id)),'[]'::jsonb))
from public.ordini_testate o where o.origine='mexal_oct' and o.mexal_eliminato_il is not null;

create function public.complete_deleted_oct(p_order_id uuid,p_generation uuid,p_response jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare o public.ordini_testate%rowtype; q public.workspace_oct_deletions%rowtype; r record;
begin
  select * into o from public.ordini_testate where id=p_order_id for update;
  select * into q from public.workspace_oct_deletions where order_id=p_order_id for update;
  if not found then return false; end if;
  if q.status<>'PENDING' or q.generation<>p_generation or o.mexal_eliminato_il is distinct from q.deleted_at then return false; end if;
  if p_response->>'status' is distinct from 'DELETED' or p_response->>'workspaceOctId' is distinct from p_order_id::text then raise exception 'INVALID_MES_DELETION_RESPONSE'; end if;
  update public.workspace_oct_deletions set status='COMPLETED',completed_at=now(),last_error=null,mes_response=p_response where order_id=p_order_id;
  update public.ordini_testate set mexal_mes_eliminato_il=now(),mexal_mes_eliminazione_errore=null where id=p_order_id;
  for r in select distinct pr.id,pr.workspace_status,pr.stato,pr.external_id from public.workspace_production_requests pr
    where pr.ordine_id=p_order_id or exists(select 1 from public.workspace_production_request_items i where i.production_request_id=pr.id and i.ordine_id=p_order_id)
  loop
    -- A multi-OCT RdP remains alive for its other commercial orders.
    if not exists(select 1 from public.workspace_production_request_items i join public.ordini_testate t on t.id=i.ordine_id
      where i.production_request_id=r.id and t.mexal_mes_eliminato_il is null)
      and exists(select 1 from public.workspace_production_request_items where production_request_id=r.id)
      or (not exists(select 1 from public.workspace_production_request_items where production_request_id=r.id)
        and exists(select 1 from public.workspace_production_requests where id=r.id and ordine_id=p_order_id)) then
      update public.workspace_production_requests set stato='Cancelled',workspace_status='Cancelled',cancelled_at=coalesce(cancelled_at,now()),
        cancellation_reason='OCT eliminato in Mexal; OP e lavorazioni eliminati nel MES',updated_at=now() where id=r.id;
      update public.workspace_v4_previews set status='CANCELLED',local_row_version=local_row_version+1 where production_request_id=r.id;
      update public.workspace_v4_confirmation_mirrors m set status='CANCELLED'
        from public.workspace_v4_previews p where p.id=m.preview_id and p.production_request_id=r.id;
      insert into public.workspace_production_request_audit(production_request_id,action,previous_status,new_status,reason,details)
        values(r.id,'MEXAL_OCT_DELETED',coalesce(r.workspace_status,r.stato),'Cancelled','Cancellazione propagata al MES',p_response);
    else
      update public.workspace_v4_previews set status='STALE',local_row_version=local_row_version+1 where production_request_id=r.id and status<>'CANCELLED';
    end if;
  end loop;
  return true;
end $$;
create function public.record_deleted_oct_failure(p_order_id uuid,p_generation uuid,p_error text)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform 1 from public.ordini_testate where id=p_order_id for update;
  update public.workspace_oct_deletions set last_error=left(p_error,500),attempts=attempts+1
    where order_id=p_order_id and generation=p_generation and status='PENDING';
  if found then update public.ordini_testate set mexal_mes_eliminazione_errore=left(p_error,500) where id=p_order_id; end if;
end $$;
create function public.workspace_rdp_has_deleted_oct(p_request_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.ordini_testate o where o.mexal_eliminato_il is not null and (
    exists(select 1 from public.workspace_production_requests r where r.id=p_request_id and r.ordine_id=o.id)
    or exists(select 1 from public.workspace_production_request_items i where i.production_request_id=p_request_id and i.ordine_id=o.id)));
$$;
revoke all on function public.queue_deleted_oct(),public.complete_deleted_oct(uuid,uuid,jsonb),public.record_deleted_oct_failure(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.complete_deleted_oct(uuid,uuid,jsonb),public.record_deleted_oct_failure(uuid,uuid,text) to service_role;
revoke all on function public.workspace_rdp_has_deleted_oct(uuid) from public,anon,authenticated;
grant execute on function public.workspace_rdp_has_deleted_oct(uuid) to service_role;
create function public.guard_deleted_oct_confirmation() returns trigger language plpgsql set search_path=public as $$
declare request_id uuid;
begin
  if tg_table_name='workspace_v4_previews' then request_id:=new.production_request_id;
  else select production_request_id into request_id from public.workspace_v4_previews where id=new.preview_id; end if;
  if upper(new.status) not in ('CANCELLED','STALE','REPLACED') and public.workspace_rdp_has_deleted_oct(request_id) then
    raise exception 'OCT_DELETED_IN_MEXAL: cancellazione MES da completare';
  end if;
  return new;
end $$;
create trigger guard_deleted_oct_preview before insert or update of status on public.workspace_v4_previews
for each row execute function public.guard_deleted_oct_confirmation();
create trigger guard_deleted_oct_mirror before insert or update of status on public.workspace_v4_confirmation_mirrors
for each row execute function public.guard_deleted_oct_confirmation();
revoke all on function public.guard_deleted_oct_confirmation() from public,anon,authenticated;
commit;

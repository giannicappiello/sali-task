begin;

alter table public.workspace_v4_purchase_requirements
  drop constraint if exists workspace_v4_purchase_requirements_status_check;
alter table public.workspace_v4_purchase_requirements
  add constraint workspace_v4_purchase_requirements_status_check
  check (status in ('OPEN','IN_RFQ','QUOTED','ORDERED','PARTIAL','RECEIVED','CANCELLED'));

create table if not exists public.workspace_v4_purchase_documents (
  id bigserial primary key,
  external_id uuid not null unique,
  document_type text not null check (document_type in ('RFQ','QUOTE','SUPPLIER_ORDER')),
  parent_document_id bigint references public.workspace_v4_purchase_documents(id) on delete restrict,
  supplier_external_ref text not null,
  supplier_name text,
  document_number text,
  currency text,
  valid_until date,
  status text not null default 'OPEN' check (status in ('OPEN','ACCEPTED','ORDERED','CANCELLED')),
  idempotency_key text not null unique,
  payload_hash text not null,
  correlation_id uuid not null,
  actor text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_v4_purchase_document_lines (
  id bigserial primary key,
  document_id bigint not null references public.workspace_v4_purchase_documents(id) on delete restrict,
  requirement_id bigint not null references public.workspace_v4_purchase_requirements(id) on delete restrict,
  quantity numeric(20,6) not null check (quantity > 0),
  unit_price numeric(20,6) check (unit_price is null or unit_price >= 0),
  expected_at timestamptz,
  unique (document_id, requirement_id)
);

create index if not exists workspace_v4_purchase_documents_type_idx
  on public.workspace_v4_purchase_documents(document_type,status,created_at desc);
create index if not exists workspace_v4_purchase_lines_requirement_idx
  on public.workspace_v4_purchase_document_lines(requirement_id,document_id);

alter table public.workspace_v4_purchase_documents enable row level security;
alter table public.workspace_v4_purchase_document_lines enable row level security;
revoke all on public.workspace_v4_purchase_documents,public.workspace_v4_purchase_document_lines from anon,authenticated;
grant all on public.workspace_v4_purchase_documents,public.workspace_v4_purchase_document_lines to service_role;
grant usage,select on all sequences in schema public to service_role;

update public.workspace_v4_purchase_requirements as requirement
set required_quantity=greatest(material.gross_requirement-(greatest(material.physical_stock-material.committed_quantity,0)+material.future_supply_quantity),0),
    lineage=requirement.lineage||jsonb_build_object('calculationOwner','WORKSPACE','formula','gross - (max(physical - committed, 0) + future supply)'),
    updated_at=now()
from public.workspace_v4_preview_materials as material
where material.id=requirement.preview_material_id
  and requirement.status in ('OPEN','IN_RFQ','QUOTED')
  and greatest(material.gross_requirement-(greatest(material.physical_stock-material.committed_quantity,0)+material.future_supply_quantity),0)>0;

update public.workspace_v4_purchase_requirements as requirement
set status='CANCELLED',updated_at=now()
from public.workspace_v4_preview_materials as material
where material.id=requirement.preview_material_id
  and requirement.status='OPEN'
  and greatest(material.gross_requirement-(greatest(material.physical_stock-material.committed_quantity,0)+material.future_supply_quantity),0)<=0;

create or replace function public.create_workspace_v4_purchase_document(
  p_external_id uuid,p_document_type text,p_parent_document_id bigint,p_supplier_external_ref text,
  p_supplier_name text,p_document_number text,p_currency text,p_valid_until date,
  p_payload_hash text,p_idempotency_key text,p_correlation_id uuid,p_actor text,p_lines jsonb
) returns setof public.workspace_v4_purchase_documents
language plpgsql security definer set search_path=public as $$
declare
  v_document public.workspace_v4_purchase_documents%rowtype;
  v_parent public.workspace_v4_purchase_documents%rowtype;
  v_line jsonb;
  v_requirement public.workspace_v4_purchase_requirements%rowtype;
  v_type text := upper(trim(coalesce(p_document_type,'')));
begin
  if v_type not in ('RFQ','QUOTE','SUPPLIER_ORDER') then raise exception 'V4_PURCHASE_DOCUMENT_TYPE_INVALID'; end if;
  if nullif(trim(coalesce(p_supplier_external_ref,'')),'') is null then raise exception 'V4_PURCHASE_SUPPLIER_REQUIRED'; end if;
  if jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then raise exception 'V4_PURCHASE_LINES_REQUIRED'; end if;

  select * into v_document from public.workspace_v4_purchase_documents where idempotency_key=p_idempotency_key;
  if found then
    if v_document.payload_hash is distinct from p_payload_hash then raise exception 'V4_PURCHASE_IDEMPOTENCY_CONFLICT'; end if;
    return next v_document; return;
  end if;

  if v_type='RFQ' then
    if p_parent_document_id is not null then raise exception 'V4_PURCHASE_PARENT_NOT_ALLOWED'; end if;
  else
    select * into v_parent from public.workspace_v4_purchase_documents where id=p_parent_document_id for update;
    if not found then raise exception 'V4_PURCHASE_PARENT_REQUIRED'; end if;
    if (v_type='QUOTE' and v_parent.document_type<>'RFQ') or
       (v_type='SUPPLIER_ORDER' and v_parent.document_type<>'QUOTE') then
      raise exception 'V4_PURCHASE_PARENT_INVALID';
    end if;
  end if;

  insert into public.workspace_v4_purchase_documents(
    external_id,document_type,parent_document_id,supplier_external_ref,supplier_name,
    document_number,currency,valid_until,idempotency_key,payload_hash,correlation_id,actor)
  values(p_external_id,v_type,p_parent_document_id,trim(p_supplier_external_ref),nullif(trim(coalesce(p_supplier_name,'')),''),
    nullif(trim(coalesce(p_document_number,'')),''),nullif(upper(trim(coalesce(p_currency,''))),''),p_valid_until,
    p_idempotency_key,p_payload_hash,p_correlation_id,p_actor)
  returning * into v_document;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    select * into v_requirement from public.workspace_v4_purchase_requirements
      where id=(v_line->>'requirementId')::bigint for update;
    if not found or v_requirement.status in ('RECEIVED','CANCELLED') then raise exception 'V4_PURCHASE_REQUIREMENT_INVALID'; end if;
    if (v_line->>'quantity')::numeric<=0 or (v_line->>'quantity')::numeric>v_requirement.required_quantity then
      raise exception 'V4_PURCHASE_QUANTITY_INVALID';
    end if;
    if v_type<>'RFQ' and not exists (
      select 1 from public.workspace_v4_purchase_document_lines
      where document_id=v_parent.id and requirement_id=v_requirement.id
    ) then raise exception 'V4_PURCHASE_LINEAGE_INVALID'; end if;

    insert into public.workspace_v4_purchase_document_lines(document_id,requirement_id,quantity,unit_price,expected_at)
    values(v_document.id,v_requirement.id,(v_line->>'quantity')::numeric,
      nullif(v_line->>'unitPrice','')::numeric,nullif(v_line->>'expectedAt','')::timestamptz);
    update public.workspace_v4_purchase_requirements set status=case v_type
      when 'RFQ' then 'IN_RFQ' when 'QUOTE' then 'QUOTED' else 'ORDERED' end,updated_at=now()
      where id=v_requirement.id;
  end loop;

  if v_type='QUOTE' then update public.workspace_v4_purchase_documents set status='ACCEPTED',updated_at=now() where id=v_parent.id;
  elsif v_type='SUPPLIER_ORDER' then update public.workspace_v4_purchase_documents set status='ORDERED',updated_at=now() where id=v_parent.id; end if;
  return next v_document;
end $$;
revoke all on function public.create_workspace_v4_purchase_document(uuid,text,bigint,text,text,text,text,date,text,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_workspace_v4_purchase_document(uuid,text,bigint,text,text,text,text,date,text,text,uuid,text,jsonb) to service_role;

create or replace function public.confirm_workspace_v4_after_mes(
 p_preview_id bigint,p_external_id uuid,p_idempotency_key text,p_payload_hash text,p_expected_row_version integer,
 p_decision text,p_mes_response jsonb,p_actor text,p_reason text,p_correlation_id uuid,p_causation_id uuid
) returns setof public.workspace_v4_confirmation_mirrors language plpgsql security definer set search_path=public as $$
declare v_preview public.workspace_v4_previews%rowtype; v_confirmation public.workspace_v4_confirmation_mirrors%rowtype; v_material public.workspace_v4_preview_materials%rowtype; v_required numeric(20,6);
begin
 if not coalesce((select enabled from public.workspace_v4_feature_flags where key='workspacemes.v4.confirm'),false) then raise exception 'WORKSPACEMES_V4_CONFIRM_DISABLED'; end if;
 select * into v_confirmation from public.workspace_v4_confirmation_mirrors where idempotency_key=p_idempotency_key;
 if found then
   if v_confirmation.payload_hash is distinct from p_payload_hash then raise exception 'V4_IDEMPOTENCY_CONFLICT'; end if;
   return next v_confirmation; return;
 end if;
 select * into v_preview from public.workspace_v4_previews where id=p_preview_id for update;
 if not found or v_preview.local_row_version<>p_expected_row_version or v_preview.status not in('READY','BLOCKED') then raise exception 'STALE_V4_PREVIEW'; end if;
 insert into public.workspace_v4_confirmation_mirrors(external_id,preview_id,idempotency_key,payload_hash,decision,status,mes_response,actor,reason,correlation_id,causation_id)
 values(p_external_id,p_preview_id,p_idempotency_key,p_payload_hash,upper(p_decision),coalesce(p_mes_response->>'status','CONFIRMED'),p_mes_response,p_actor,p_reason,p_correlation_id,p_causation_id)
 returning * into v_confirmation;
 if coalesce((select enabled from public.workspace_v4_feature_flags where key='workspacemes.v4.purchasing'),false) then
   for v_material in select * from public.workspace_v4_preview_materials where preview_id=p_preview_id loop
     v_required := greatest(v_material.gross_requirement - (greatest(v_material.physical_stock-v_material.committed_quantity,0)+v_material.future_supply_quantity),0);
     if v_required>0 then
       insert into public.workspace_v4_purchase_requirements(confirmation_id,preview_material_id,article_code,description,unit_of_measure,required_quantity,required_at,lineage)
       values(v_confirmation.id,v_material.id,v_material.article_code,v_material.description,v_material.unit_of_measure,v_required,v_material.required_at,
         jsonb_build_object('contractVersion',4,'calculationOwner','WORKSPACE','formula','gross - (max(physical - committed, 0) + future supply)','previewExternalId',v_preview.external_id,'workspaceLineId',v_material.workspace_line_id,'finishedArticleCode',v_material.finished_article_code,'certifiedHash',v_material.certified_hash));
     end if;
   end loop;
 end if;
 update public.workspace_v4_previews set status='CONFIRMED',confirmed_at=now(),local_row_version=local_row_version+1 where id=p_preview_id;
 update public.workspace_production_requests set stato='CONFIRMED',workspace_status='CONFIRMED',last_error_code=null,last_response=p_mes_response,updated_at=now() where id=v_preview.production_request_id;
 return next v_confirmation;
end $$;
revoke all on function public.confirm_workspace_v4_after_mes(bigint,uuid,text,text,integer,text,jsonb,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_workspace_v4_after_mes(bigint,uuid,text,text,integer,text,jsonb,text,text,uuid,uuid) to service_role;

comment on table public.workspace_v4_purchase_requirements is 'Fabbisogni V4 calcolati e governati da Workspace a partire dai dati certificati MES.';
comment on table public.workspace_v4_purchase_documents is 'Richieste preventivo, preventivi e ordini fornitore gestiti da Workspace V4.';

commit;

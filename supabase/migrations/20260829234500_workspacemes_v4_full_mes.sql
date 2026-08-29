begin;

create table if not exists public.workspace_v4_feature_flags (
  key text primary key, enabled boolean not null default false, description text not null,
  updated_at timestamptz not null default now(), updated_by text
);
insert into public.workspace_v4_feature_flags(key,enabled,description) values
 ('workspacemes.v4.preview',true,'Preview completa e certificata da ProgreMES'),
 ('workspacemes.v4.confirm',true,'Conferma atomica V4 su ProgreMES'),
 ('workspacemes.v4.purchasing',true,'Fabbisogni acquisto derivati dalle carenze MES')
on conflict(key) do update set enabled=excluded.enabled,description=excluded.description,updated_at=now();
update public.workspace_v3_feature_flags set enabled=false,updated_at=now(),updated_by='migration:v4-cutover';

create table if not exists public.workspace_v4_previews (
 id bigserial primary key, external_id uuid not null unique, production_request_id uuid not null references public.workspace_production_requests(id) on delete restrict,
 preview_hash text not null, idempotency_key text not null unique, payload_hash text not null,
 status text not null check(status in('READY','BLOCKED','STALE','CONFIRMED','CANCELLED')),
 oct_hash text not null, mes_row_version text not null, local_row_version integer not null default 1,
 snapshot jsonb not null, correlation_id uuid not null, causation_id uuid, requested_by uuid,
 captured_at timestamptz not null default now(), confirmed_at timestamptz
);
create table if not exists public.workspace_v4_preview_materials (
 id bigserial primary key, preview_id bigint not null references public.workspace_v4_previews(id) on delete restrict,
 workspace_line_id uuid not null, finished_article_code text not null, source text not null,
 article_code text not null, description text, unit_of_measure text not null,
 gross_requirement numeric(20,6) not null check(gross_requirement>=0), physical_stock numeric(20,6) not null check(physical_stock>=0),
 committed_quantity numeric(20,6) not null check(committed_quantity>=0), net_stock numeric(20,6) not null check(net_stock>=0),
 future_supply_quantity numeric(20,6) not null check(future_supply_quantity>=0), projected_availability numeric(20,6) not null check(projected_availability>=0),
 shortage_quantity numeric(20,6) not null check(shortage_quantity>=0), available_at timestamptz, required_at timestamptz not null,
 formula_version_id integer, bom_revision integer, block_code text, certified_hash text not null,
 unique(preview_id,workspace_line_id,source,article_code,certified_hash)
);
create table if not exists public.workspace_v4_confirmation_mirrors (
 id bigserial primary key, external_id uuid not null unique, preview_id bigint not null unique references public.workspace_v4_previews(id) on delete restrict,
 idempotency_key text not null unique, payload_hash text not null, decision text not null check(decision in('COMPLETE','WITH_SHORTAGES')),
 status text not null, mes_response jsonb not null, actor text not null, reason text not null,
 correlation_id uuid not null, causation_id uuid, created_at timestamptz not null default now()
);
create table if not exists public.workspace_v4_purchase_requirements (
 id bigserial primary key, confirmation_id bigint not null references public.workspace_v4_confirmation_mirrors(id) on delete restrict,
 preview_material_id bigint not null references public.workspace_v4_preview_materials(id) on delete restrict,
 article_code text not null, description text, unit_of_measure text not null,
 required_quantity numeric(20,6) not null check(required_quantity>0), required_at timestamptz not null,
 status text not null default 'OPEN' check(status in('OPEN','ORDERED','PARTIAL','RECEIVED','CANCELLED')),
 lineage jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(confirmation_id,preview_material_id)
);
create index if not exists workspace_v4_preview_request_idx on public.workspace_v4_previews(production_request_id,captured_at desc);
create index if not exists workspace_v4_material_article_idx on public.workspace_v4_preview_materials(article_code,required_at);
create index if not exists workspace_v4_purchase_open_idx on public.workspace_v4_purchase_requirements(status,required_at);

alter table public.workspace_v4_feature_flags enable row level security;
alter table public.workspace_v4_previews enable row level security;
alter table public.workspace_v4_preview_materials enable row level security;
alter table public.workspace_v4_confirmation_mirrors enable row level security;
alter table public.workspace_v4_purchase_requirements enable row level security;
revoke all on public.workspace_v4_feature_flags,public.workspace_v4_previews,public.workspace_v4_preview_materials,
 public.workspace_v4_confirmation_mirrors,public.workspace_v4_purchase_requirements from anon,authenticated;
grant all on public.workspace_v4_feature_flags,public.workspace_v4_previews,public.workspace_v4_preview_materials,
 public.workspace_v4_confirmation_mirrors,public.workspace_v4_purchase_requirements to service_role;
grant usage,select on all sequences in schema public to service_role;

create or replace function public.persist_workspace_v4_preview(
 p_external_id uuid,p_production_request_id uuid,p_preview_hash text,p_idempotency_key text,p_payload_hash text,
 p_status text,p_oct_hash text,p_row_version text,p_snapshot jsonb,p_correlation_id uuid,p_causation_id uuid,
 p_requested_by uuid,p_materials jsonb
) returns setof public.workspace_v4_previews language plpgsql security definer set search_path=public as $$
declare v_preview public.workspace_v4_previews%rowtype; v_material jsonb;
begin
 if not coalesce((select enabled from public.workspace_v4_feature_flags where key='workspacemes.v4.preview'),false) then raise exception 'WORKSPACEMES_V4_PREVIEW_DISABLED'; end if;
 select * into v_preview from public.workspace_v4_previews where idempotency_key=p_idempotency_key;
 if found then
   if v_preview.payload_hash is distinct from p_payload_hash then raise exception 'V4_IDEMPOTENCY_CONFLICT'; end if;
   return next v_preview; return;
 end if;
 insert into public.workspace_v4_previews(external_id,production_request_id,preview_hash,idempotency_key,payload_hash,status,oct_hash,mes_row_version,snapshot,correlation_id,causation_id,requested_by)
 values(p_external_id,p_production_request_id,p_preview_hash,p_idempotency_key,p_payload_hash,upper(p_status),p_oct_hash,p_row_version,p_snapshot,p_correlation_id,p_causation_id,p_requested_by)
 returning * into v_preview;
 for v_material in select value from jsonb_array_elements(coalesce(p_materials,'[]'::jsonb)) loop
   insert into public.workspace_v4_preview_materials(preview_id,workspace_line_id,finished_article_code,source,article_code,description,unit_of_measure,
    gross_requirement,physical_stock,committed_quantity,net_stock,future_supply_quantity,projected_availability,shortage_quantity,available_at,required_at,
    formula_version_id,bom_revision,block_code,certified_hash)
   values(v_preview.id,(v_material->>'workspace_line_id')::uuid,v_material->>'finished_article_code',v_material->>'source',v_material->>'article_code',
    v_material->>'description',v_material->>'unit_of_measure',(v_material->>'gross_requirement')::numeric,(v_material->>'physical_stock')::numeric,
    (v_material->>'committed_quantity')::numeric,(v_material->>'net_stock')::numeric,(v_material->>'future_supply_quantity')::numeric,
    (v_material->>'projected_availability')::numeric,(v_material->>'shortage_quantity')::numeric,nullif(v_material->>'available_at','')::timestamptz,
    (v_material->>'required_at')::timestamptz,nullif(v_material->>'formula_version_id','')::integer,nullif(v_material->>'bom_revision','')::integer,
    nullif(v_material->>'block_code',''),v_material->>'certified_hash');
 end loop;
 return next v_preview;
end $$;
revoke all on function public.persist_workspace_v4_preview(uuid,uuid,text,text,text,text,text,text,jsonb,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.persist_workspace_v4_preview(uuid,uuid,text,text,text,text,text,text,jsonb,uuid,uuid,uuid,jsonb) to service_role;

create or replace function public.confirm_workspace_v4_after_mes(
 p_preview_id bigint,p_external_id uuid,p_idempotency_key text,p_payload_hash text,p_expected_row_version integer,
 p_decision text,p_mes_response jsonb,p_actor text,p_reason text,p_correlation_id uuid,p_causation_id uuid
) returns setof public.workspace_v4_confirmation_mirrors language plpgsql security definer set search_path=public as $$
declare v_preview public.workspace_v4_previews%rowtype; v_confirmation public.workspace_v4_confirmation_mirrors%rowtype; v_material public.workspace_v4_preview_materials%rowtype;
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
   for v_material in select * from public.workspace_v4_preview_materials where preview_id=p_preview_id and shortage_quantity>0 loop
     insert into public.workspace_v4_purchase_requirements(confirmation_id,preview_material_id,article_code,description,unit_of_measure,required_quantity,required_at,lineage)
     values(v_confirmation.id,v_material.id,v_material.article_code,v_material.description,v_material.unit_of_measure,v_material.shortage_quantity,v_material.required_at,
       jsonb_build_object('contractVersion',4,'previewExternalId',v_preview.external_id,'workspaceLineId',v_material.workspace_line_id,'finishedArticleCode',v_material.finished_article_code,'certifiedHash',v_material.certified_hash));
   end loop;
 end if;
 update public.workspace_v4_previews set status='CONFIRMED',confirmed_at=now(),local_row_version=local_row_version+1 where id=p_preview_id;
 update public.workspace_production_requests set stato='CONFIRMED',workspace_status='CONFIRMED',last_error_code=null,last_response=p_mes_response,updated_at=now() where id=v_preview.production_request_id;
 return next v_confirmation;
end $$;
revoke all on function public.confirm_workspace_v4_after_mes(bigint,uuid,text,text,integer,text,jsonb,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_workspace_v4_after_mes(bigint,uuid,text,text,integer,text,jsonb,text,text,uuid,uuid) to service_role;

alter table public.workspace_production_requests alter column contract_version set default 4;

create or replace function public.record_workspace_production_demand(p_create_request boolean,p_idempotency_key text,p_demand_hash text,p_snapshot_hash text,p_snapshot jsonb,p_requested_by uuid default null)
returns table(request_id uuid,external_id uuid,snapshot_id bigint,snapshot_hash text,snapshot_captured_at timestamptz,reused boolean,attempt_count integer)
language plpgsql security definer set search_path=public as $$
declare v_request public.workspace_production_requests%rowtype; v_snapshot public.workspace_production_demand_snapshots%rowtype; v_item jsonb; v_reused boolean:=false;
begin
 if coalesce((p_snapshot->>'version')::integer,0)<>4 or coalesce((p_snapshot->>'contractVersion')::integer,0)<>4 or p_snapshot->>'kind'<>'MULTI_OCT_PRODUCTION_DEMAND' then raise exception 'INVALID_MULTI_OCT_V4_DEMAND'; end if;
 if p_create_request then
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key,0));
  select * into v_request from public.workspace_production_requests where idempotency_key=p_idempotency_key and contract_version=4 and upper(coalesce(workspace_status,stato,''))<>'CANCELLED' order by created_at desc limit 1 for update;
  if found then if v_request.demand_hash is distinct from p_demand_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if; v_reused:=true;
  else insert into public.workspace_production_requests(ordine_id,ordine_riga_id,idempotency_key,demand_hash,contract_version,request_kind,requested_by,stato,workspace_status)
   values(((p_snapshot->'items'->0)->>'orderId')::uuid,((p_snapshot->'items'->0)->>'lineId')::uuid,p_idempotency_key,p_demand_hash,4,'WORKSPACEMES_V4_DEMAND',p_requested_by,'PREVIEWING','PREVIEWING') returning * into v_request; end if;
 end if;
 select * into v_snapshot from public.workspace_production_demand_snapshots where production_request_id is not distinct from v_request.id and snapshot_hash=p_snapshot_hash;
 if found then v_reused:=true; else insert into public.workspace_production_demand_snapshots(production_request_id,snapshot_hash,demand_hash,contract_version,order_count,item_count,requested_by,snapshot)
  values(v_request.id,p_snapshot_hash,p_demand_hash,4,(p_snapshot->>'orderCount')::integer,(p_snapshot->>'itemCount')::integer,p_requested_by,p_snapshot) returning * into v_snapshot; end if;
 if p_create_request then
  for v_item in select value from jsonb_array_elements(p_snapshot->'items') loop
   insert into public.workspace_production_request_items(production_request_id,ordine_id,ordine_riga_id,item_index,item_external_key,mexal_order_key,mexal_line_position,codice_articolo_commerciale,codice_articolo_produttivo,mapping_status,quantita_oct,unita_misura_oct,quantita_unita_produzione,unita_misura_produzione,conversione,data_consegna_richiesta)
   values(v_request.id,(v_item->>'orderId')::uuid,(v_item->>'lineId')::uuid,(v_item->>'itemIndex')::integer,v_item->>'itemExternalKey',v_item->>'mexalOrderKey',nullif(v_item->>'mexalLinePosition','')::integer,v_item->>'commercialArticleCode',v_item->>'commercialArticleCode','MES_V4_AUTHORITATIVE',(v_item->>'requestedQuantity')::numeric,v_item->>'requestedUnitOfMeasure',(v_item->>'productionQuantity')::numeric,v_item->>'productionUnitOfMeasure',v_item->'conversion',nullif(v_item->>'requestedDeliveryDate','')::date)
   on conflict(production_request_id,ordine_riga_id) do nothing;
  end loop;
  update public.workspace_production_requests set demand_snapshot_id=v_snapshot.id,updated_at=now() where id=v_request.id returning * into v_request;
 end if;
 return query select v_request.id,v_request.external_id,v_snapshot.id,v_snapshot.snapshot_hash,v_snapshot.captured_at,v_reused,coalesce(v_request.attempt_count,0);
end $$;
revoke all on function public.record_workspace_production_demand(boolean,text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.record_workspace_production_demand(boolean,text,text,text,jsonb,uuid) to service_role;

comment on table public.workspace_v4_previews is 'Mirror immutabile della preview completa calcolata da ProgreMES V4; Workspace non esegue netting.';
comment on table public.workspace_v4_purchase_requirements is 'Carenze certificate MES trasformate in fabbisogni acquisto Workspace.';
commit;

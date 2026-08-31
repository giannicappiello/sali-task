begin;

create table if not exists public.workspace_sali_replenishment_article_settings (
  article_code text primary key,
  lead_time_days integer check (lead_time_days is null or lead_time_days > 0),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_sali_replenishment_proposals (
  id bigserial primary key,
  external_id uuid not null default gen_random_uuid() unique,
  proposal_date date not null unique,
  customer_code text not null,
  warehouse_number integer not null check (warehouse_number > 0),
  previous_period_start date not null,
  current_period_start date not null,
  current_period_end date not null,
  calculation_version integer not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','SENT_TO_MEXAL','CANCELLED')),
  actor text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_sali_replenishment_proposal_lines (
  id bigserial primary key,
  proposal_id bigint not null references public.workspace_sali_replenishment_proposals(id) on delete restrict,
  article_code text not null,
  description text,
  unit_of_measure text not null,
  current_monthly_average numeric(20,6) not null check (current_monthly_average >= 0),
  previous_monthly_average numeric(20,6) not null check (previous_monthly_average >= 0),
  estimated_monthly_consumption numeric(20,6) not null check (estimated_monthly_consumption >= 0),
  available_stock numeric(20,6) not null,
  lead_time_days integer not null check (lead_time_days > 0),
  replenishment_requirement numeric(20,6) not null check (replenishment_requirement >= 0),
  proposed_quantity numeric(20,6) not null check (proposed_quantity > 0),
  approved_quantity numeric(20,6) check (approved_quantity is null or approved_quantity >= 0),
  required_at date not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','EXCLUDED','SENT_TO_MEXAL')),
  unique (proposal_id, article_code)
);

create index if not exists workspace_sali_replenishment_status_idx
  on public.workspace_sali_replenishment_proposals(status,proposal_date desc);

alter table public.workspace_sali_replenishment_article_settings enable row level security;
alter table public.workspace_sali_replenishment_proposals enable row level security;
alter table public.workspace_sali_replenishment_proposal_lines enable row level security;
revoke all on public.workspace_sali_replenishment_article_settings,public.workspace_sali_replenishment_proposals,public.workspace_sali_replenishment_proposal_lines from public,anon,authenticated;
grant all on public.workspace_sali_replenishment_article_settings,public.workspace_sali_replenishment_proposals,public.workspace_sali_replenishment_proposal_lines to service_role;
grant usage,select on all sequences in schema public to service_role;

create or replace function public.create_workspace_sali_replenishment_proposal(
  p_proposal_date date,p_customer_code text,p_warehouse_number integer,
  p_previous_period_start date,p_current_period_start date,p_current_period_end date,
  p_calculation_version integer,p_actor text,p_lines jsonb
) returns table(id bigint,external_id uuid,status text,was_created boolean)
language plpgsql security definer set search_path=public as $$
declare v_proposal public.workspace_sali_replenishment_proposals%rowtype; v_line jsonb;
begin
  select * into v_proposal from public.workspace_sali_replenishment_proposals where proposal_date=p_proposal_date;
  if found then return query select v_proposal.id,v_proposal.external_id,v_proposal.status,false; return; end if;
  if jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then raise exception 'SALI_REPLENISHMENT_LINES_REQUIRED'; end if;
  insert into public.workspace_sali_replenishment_proposals(
    proposal_date,customer_code,warehouse_number,previous_period_start,current_period_start,current_period_end,calculation_version,actor)
  values(p_proposal_date,trim(p_customer_code),p_warehouse_number,p_previous_period_start,p_current_period_start,p_current_period_end,p_calculation_version,p_actor)
  returning * into v_proposal;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    insert into public.workspace_sali_replenishment_proposal_lines(
      proposal_id,article_code,description,unit_of_measure,current_monthly_average,previous_monthly_average,
      estimated_monthly_consumption,available_stock,lead_time_days,replenishment_requirement,proposed_quantity,required_at)
    values(v_proposal.id,upper(trim(v_line->>'articleCode')),nullif(trim(coalesce(v_line->>'description','')),''),
      coalesce(nullif(trim(v_line->>'unitOfMeasure'),''),'PZ'),(v_line->>'currentMonthlyAverage')::numeric,
      (v_line->>'previousMonthlyAverage')::numeric,(v_line->>'estimatedMonthlyConsumption')::numeric,
      (v_line->>'availableStock')::numeric,(v_line->>'leadTimeDays')::integer,
      (v_line->>'replenishmentRequirement')::numeric,(v_line->>'proposedQuantity')::numeric,(v_line->>'requiredAt')::date);
  end loop;
  return query select v_proposal.id,v_proposal.external_id,v_proposal.status,true;
end $$;

revoke all on function public.create_workspace_sali_replenishment_proposal(date,text,integer,date,date,date,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_workspace_sali_replenishment_proposal(date,text,integer,date,date,date,integer,text,jsonb) to service_role;

comment on table public.workspace_sali_replenishment_proposals is 'Proposte di riassortimento Sali di Ischia calcolate e governate esclusivamente da Workspace.';
comment on table public.workspace_sali_replenishment_proposal_lines is 'Dettaglio e prove di calcolo del riassortimento Sali di Ischia; non rappresenta un OCT Mexal.';

commit;

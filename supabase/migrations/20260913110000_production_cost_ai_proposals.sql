-- Proposals are drafts, never executable code or active configurations.
create table public.production_cost_ai_proposals (
 id uuid primary key,
 created_by uuid not null references public.utenti(id),
 parent_id uuid references public.production_cost_ai_proposals(id),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 status text not null default 'pending' check(status in ('pending','complete','error')),
 prompt text not null check(length(prompt)<=6000),
 base_settings jsonb not null,
 model text not null,
 result jsonb,
 candidate jsonb,
 usage jsonb,
 generation_id uuid references public.ai_generazioni(id),
 error text
);
create index production_cost_ai_proposals_owner_date on public.production_cost_ai_proposals(created_by,created_at desc);
alter table public.production_cost_ai_proposals enable row level security;
revoke all on public.production_cost_ai_proposals from public,anon,authenticated;
grant all on public.production_cost_ai_proposals to service_role;
comment on table public.production_cost_ai_proposals is 'Private owner-scoped AI cost drafts. Server checks screen write permission and AI entitlement. No direct client writes.';

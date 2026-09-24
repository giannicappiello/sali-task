-- Every scan has an observable outcome, including no comparable evidence or connector failure.
create table public.ai_learning_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  state text not null check (state in ('running','completed','no_evidence','connector_disabled','failed')),
  candidates integer not null default 0 check(candidates >= 0),
  proposals_created integer not null default 0 check(proposals_created >= 0),
  detail text
);
create index ai_learning_runs_started_idx on public.ai_learning_runs(started_at desc);
alter table public.ai_learning_runs enable row level security;
create policy "admins read learning runs" on public.ai_learning_runs
  for select to authenticated using(public.workspace_user_is_admin());
revoke all on public.ai_learning_runs from anon,authenticated;
grant select on public.ai_learning_runs to authenticated;
grant all on public.ai_learning_runs to service_role;

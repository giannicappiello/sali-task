-- Immutable source revisions, including closed works and calendar evidence.
-- No existing production/configuration snapshot is overwritten.
create table public.production_cost_station_history (
 id uuid primary key default gen_random_uuid(),
 fingerprint text not null unique,
 created_at timestamptz not null default now(),
 source jsonb not null
);
alter table public.production_cost_station_history enable row level security;
revoke all on public.production_cost_station_history from public,anon,authenticated,service_role;
grant select,insert on public.production_cost_station_history to service_role;
comment on table public.production_cost_station_history is 'Server-only MES department evidence. Immutable revisions deduplicated by fingerprint; callers receive aggregates, never other customers work IDs.';

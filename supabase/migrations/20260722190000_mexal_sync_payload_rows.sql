create table if not exists public.mexal_sync_payload_rows (
  run_id bigint not null references public.mexal_sync_runs(id) on delete cascade,
  row_index integer not null,
  raw_data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, row_index)
);

create index if not exists mexal_sync_payload_rows_run_idx
  on public.mexal_sync_payload_rows (run_id, row_index);

alter table public.mexal_sync_payload_rows enable row level security;

comment on table public.mexal_sync_payload_rows is
  'Payload temporaneo server-side usato per suddividere le sincronizzazioni Mexal in richieste brevi e riprendibili.';

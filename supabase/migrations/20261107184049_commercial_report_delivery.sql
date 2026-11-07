-- Private execution state: only the server can read tokens, PDFs and recipients.
create table public.commercial_report_settings (
  singleton boolean primary key default true check(singleton),
  owner_id uuid not null references public.utenti(id),
  enabled boolean not null default false,
  policy_hash text not null,
  trigger_id text not null check(trigger_id ~ '^agtch_[A-Za-z0-9_]+$'),
  token_encrypted text not null,
  approved_at timestamptz not null default now()
);
create table public.commercial_report_batches (
  id uuid primary key default gen_random_uuid(),
  period date not null unique check(extract(day from period)=1),
  owner_id uuid not null references public.utenti(id),
  policy_hash text not null,
  manifest jsonb not null check(jsonb_typeof(manifest)='array'),
  recipients_hash text not null,
  status text not null default 'triggering' check(status in ('triggering','requested','queued','sent','attention')),
  conversation_url text,
  trigger_run_id text,
  created_at timestamptz not null default now()
);
create table public.commercial_report_chunks (
  batch_id uuid not null references public.commercial_report_batches(id),
  artifact_key text not null,
  part integer not null check(part>=0 and part<100),
  total integer not null check(total>0 and total<=100),
  base64 text not null check(length(base64)<=40000 and base64 ~ '^[A-Za-z0-9+/=]+$'),
  primary key(batch_id,artifact_key,part)
);
create table public.commercial_report_files (
  batch_id uuid not null references public.commercial_report_batches(id),
  artifact_key text not null,
  period date not null,
  network text not null check(network in ('prof','ph')),
  source text not null check(source in ('fatture','ordiniph')),
  filename text not null,
  base64 text not null,
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  bytes integer not null check(bytes>0 and bytes<=2000000),
  verified boolean not null default false,
  pages integer not null check(pages>0),
  primary key(batch_id,artifact_key)
);
create table public.commercial_report_emails (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.commercial_report_batches(id),
  delivery_key text not null,
  recipient text not null,
  subject text not null,
  body text not null,
  artifact_keys jsonb not null check(jsonb_typeof(artifact_keys)='array'),
  status text not null default 'pending' check(status in ('pending','uncertain','sent','failed')),
  worker_id text,
  lock_token uuid,
  provider_message_id text,
  claimed_at timestamptz,
  sent_at timestamptz,
  unique(batch_id,delivery_key)
);
alter table public.commercial_report_settings enable row level security;
alter table public.commercial_report_batches enable row level security;
alter table public.commercial_report_chunks enable row level security;
alter table public.commercial_report_files enable row level security;
alter table public.commercial_report_emails enable row level security;
revoke all on public.commercial_report_settings, public.commercial_report_batches, public.commercial_report_chunks, public.commercial_report_files, public.commercial_report_emails from public,anon,authenticated;
grant all on public.commercial_report_settings, public.commercial_report_batches, public.commercial_report_chunks, public.commercial_report_files, public.commercial_report_emails to service_role;

-- Atomic claim, marked uncertain BEFORE the worker receives any content.
-- A lost response or uncertain mail result must never be automatically retried.
create or replace function public.commercial_report_claim_email(p_worker text)
returns setof public.commercial_report_emails language sql security invoker
set search_path='' as $$
  with candidate as (
    select e.id from public.commercial_report_emails e
    join public.commercial_report_batches b on b.id=e.batch_id
    join public.commercial_report_settings s on s.singleton
    join public.utenti u on u.id=s.owner_id
    join public.ruoli r on r.id=u.ruolo_id
    where e.status='pending' and b.status='queued' and s.enabled
      and now() >= (((b.period + interval '1 month 9 days')::date + time '10:00') at time zone 'Europe/Rome')
      and now() < (((b.period + interval '1 month 10 days')::date + time '00:00') at time zone 'Europe/Rome')
      and s.owner_id=b.owner_id and s.policy_hash=b.policy_hash
      and u.attivo is true and r.amministratore_workspace is true
    order by (e.delivery_key='aggregate'),e.id
    for update of e skip locked limit 1
  )
  update public.commercial_report_emails e
  set status='uncertain',worker_id=p_worker,lock_token=gen_random_uuid(),claimed_at=now()
  from candidate where e.id=candidate.id returning e.*;
$$;
revoke all on function public.commercial_report_claim_email(text) from public,anon,authenticated;
grant execute on function public.commercial_report_claim_email(text) to service_role;

-- Queue the entire verified batch once. All envelopes exist atomically or none do.
create or replace function public.commercial_report_queue(p_batch uuid,p_jobs jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.commercial_report_batches where id=p_batch and status='queued') then return; end if;
  perform 1 from public.commercial_report_batches where id=p_batch and status='requested' for update;
  if not found then raise exception 'Lotto non pronto o già accodato'; end if;
  if jsonb_array_length(p_jobs)<1 or jsonb_array_length(p_jobs)>40 then raise exception 'Distribuzione incompleta'; end if;
  if (select count(*) from jsonb_array_elements(p_jobs) j where j->>'delivery_key'='aggregate')<>1 then raise exception 'Email centrale non valida'; end if;
  insert into public.commercial_report_emails(batch_id,delivery_key,recipient,subject,body,artifact_keys)
  select p_batch,j->>'delivery_key',j->>'recipient',j->>'subject',j->>'body',j->'artifact_keys' from jsonb_array_elements(p_jobs) j;
  update public.commercial_report_batches set status='queued' where id=p_batch;
end;
$$;
revoke all on function public.commercial_report_queue(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commercial_report_queue(uuid,jsonb) to service_role;

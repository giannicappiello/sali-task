begin;
create table public.ai_development_hosts (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(name) between 1 and 100),
  token_hash text not null unique check(length(token_hash)=64),
  active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  diagnostics jsonb not null default '{}'::jsonb
);
create table public.ai_development_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid,
  repository text not null check(repository in ('workspace','mes')),
  instruction text not null check(length(instruction) between 10 and 12000),
  status text not null default 'proposed' check(status in ('proposed','queued','running','review','failed','interrupted','rejected')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  finished_at timestamptz,
  host_id uuid references public.ai_development_hosts(id),
  lease_token uuid,
  lease_until timestamptz,
  source_commit text,
  generation_count integer not null default 0 check(generation_count between 0 and 4),
  result jsonb,
  error text
);
create index ai_development_jobs_queue_idx on public.ai_development_jobs(status,created_at);
alter table public.ai_development_hosts enable row level security;
alter table public.ai_development_jobs enable row level security;
revoke all on public.ai_development_hosts,public.ai_development_jobs from public,anon,authenticated;
grant select(id,name,active,created_by,created_at,last_seen_at,diagnostics) on public.ai_development_hosts to authenticated;
grant select on public.ai_development_jobs to authenticated;
grant all on public.ai_development_hosts,public.ai_development_jobs to service_role;
create policy "administrators inspect development hosts" on public.ai_development_hosts for select to authenticated using(public.workspace_user_is_admin());
create policy "administrators inspect development jobs" on public.ai_development_jobs for select to authenticated using(public.workspace_user_is_admin());

-- A crash is never retried automatically. Its output may be incomplete.
create function public.claim_ai_development_job(p_host_id uuid)
returns setof public.ai_development_jobs language plpgsql security definer set search_path=public as $$
declare selected_id uuid;
begin
  if not exists(select 1 from public.ai_development_hosts where id=p_host_id and active) then raise exception 'HOST_DISABLED'; end if;
  update public.ai_development_jobs set status='interrupted',finished_at=now(),error='Il worker non ha rinnovato la sessione. Verificare il risultato prima di ripetere.'
    where status='running' and lease_until < now();
  select j.id into selected_id from public.ai_development_jobs j where j.status='queued'
    and exists(select 1 from public.utenti u join public.ruoli r on r.id=u.ruolo_id where u.id=j.user_id and u.attivo and r.amministratore_workspace)
    order by j.created_at,j.id for update skip locked limit 1;
  if selected_id is null then return; end if;
  return query update public.ai_development_jobs set status='running',host_id=p_host_id,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    where id=selected_id returning *;
end $$;
revoke all on function public.claim_ai_development_job(uuid) from public,anon,authenticated;
grant execute on function public.claim_ai_development_job(uuid) to service_role;

create function public.reserve_ai_development_generation(p_job_id uuid,p_host_id uuid,p_lease_token uuid,p_commit text)
returns setof public.ai_development_jobs language plpgsql security definer set search_path=public as $$
begin
  if p_commit !~ '^[a-f0-9]{40}$' then raise exception 'INVALID_COMMIT'; end if;
  return query update public.ai_development_jobs j set generation_count=j.generation_count+1,source_commit=p_commit
    where j.id=p_job_id and j.host_id=p_host_id and j.lease_token=p_lease_token and j.status='running' and j.lease_until>now()
    and j.generation_count<4 and (j.source_commit is null or j.source_commit=p_commit)
    and exists(select 1 from public.ai_development_hosts h where h.id=p_host_id and h.active)
    and exists(select 1 from public.utenti u join public.ruoli r on r.id=u.ruolo_id where u.id=j.user_id and u.attivo and r.amministratore_workspace)
    returning j.*;
end $$;
revoke all on function public.reserve_ai_development_generation(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_ai_development_generation(uuid,uuid,uuid,text) to service_role;
commit;

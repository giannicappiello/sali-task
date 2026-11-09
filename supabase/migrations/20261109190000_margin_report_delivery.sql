-- Dedicated authorization and delivery state; no accounting or commercial-report data changed.
create table public.margin_report_plans (
 owner_id uuid primary key references public.utenti(id),
 policy_hash text not null check(policy_hash ~ '^[a-f0-9]{64}$'),
 enabled boolean not null default false,
 approved_by uuid references public.utenti(id),
 approved_at timestamptz,
 created_at timestamptz not null default now(),
 check(not enabled or (approved_by=owner_id and approved_at is not null))
);
create table public.margin_report_runs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.margin_report_plans(owner_id),
 policy_hash text not null,
 period date not null check(extract(day from period)=1),
 status text not null default 'draft' check(status in ('draft','staged','queued','uncertain','sent','failed')),
 filename text,base64 text,sha256 text,bytes integer,pages integer,
 verified boolean not null default false,
 notes text not null default '',
 worker_id text,lock_token uuid,claimed_at timestamptz,sent_at timestamptz,provider_message_id text,
 created_at timestamptz not null default now(),
 unique(owner_id,period),
 check(status='draft' or (verified and base64 is not null and sha256 ~ '^[a-f0-9]{64}$' and bytes between 1 and 2000000 and pages>=3))
);
create table public.margin_report_chunks (
 run_id uuid not null references public.margin_report_runs(id),
 part integer not null check(part between 0 and 99),total integer not null check(total between 1 and 100),
 base64 text not null check(length(base64)<=40000 and base64 ~ '^[A-Za-z0-9+/=]+$'),
 primary key(run_id,part),check(part<total)
);
alter table public.margin_report_plans enable row level security;
alter table public.margin_report_runs enable row level security;
alter table public.margin_report_chunks enable row level security;
revoke all on public.margin_report_plans,public.margin_report_runs,public.margin_report_chunks from public,anon,authenticated;
grant all on public.margin_report_plans,public.margin_report_runs,public.margin_report_chunks to service_role;
create index margin_report_runs_claim on public.margin_report_runs(created_at) where status='queued';
create function public.margin_report_activate(p_owner uuid,p_policy text,p_run uuid,p_pdf text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.margin_report_plans p join public.utenti u on u.id=p.owner_id join public.ruoli r on r.id=u.ruolo_id
 where p.owner_id=p_owner and p.policy_hash=p_policy and u.attivo and r.amministratore_workspace for update of p;
 if not found then raise exception 'PLAN_NOT_AUTHORIZED';end if;
 perform 1 from public.margin_report_runs where id=p_run and owner_id=p_owner and policy_hash=p_policy and sha256=p_pdf and verified and status='staged' for update;
 if not found then raise exception 'PDF_CHANGED';end if;
 update public.margin_report_plans set enabled=true,approved_by=p_owner,approved_at=now() where owner_id=p_owner;
 update public.margin_report_runs set status='queued' where id=p_run;
 return true;
end $$;
create function public.margin_report_claim(p_worker text,p_policy text)
returns setof public.margin_report_runs language sql security invoker set search_path='' as $$
 with candidate as (
 select j.id from public.margin_report_runs j join public.margin_report_plans p on p.owner_id=j.owner_id
 join public.utenti u on u.id=p.owner_id join public.ruoli r on r.id=u.ruolo_id
 where j.status='queued' and p.enabled and j.policy_hash=p.policy_hash and p.policy_hash=p_policy and p.approved_by=p.owner_id and p.approved_at is not null
 and u.attivo and r.amministratore_workspace order by j.created_at for update of j skip locked limit 1
 ) update public.margin_report_runs j set status='uncertain',worker_id=p_worker,lock_token=gen_random_uuid(),claimed_at=now()
 from candidate where j.id=candidate.id returning j.*;
$$;
revoke all on function public.margin_report_activate(uuid,text,uuid,text),public.margin_report_claim(text,text) from public,anon,authenticated;
grant execute on function public.margin_report_activate(uuid,text,uuid,text),public.margin_report_claim(text,text) to service_role;

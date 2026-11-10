-- API channel approved by Giovanni; no new OpenAI Platform credential or paid plan.
alter table public.margin_report_plans add column agent_hash text check(agent_hash ~ '^[a-f0-9]{64}$');
create table public.margin_report_triggers (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.margin_report_plans(owner_id),
 period date not null check(extract(day from period)=1),
 policy_hash text not null check(policy_hash ~ '^[a-f0-9]{64}$'),
 agent_hash text not null check(agent_hash ~ '^[a-f0-9]{64}$'),
 status text not null check(status in ('triggering','requested','attention')),
 conversation_url text check(conversation_url ~ '^https://chatgpt[.]com/c/[a-zA-Z0-9-]+$'),
 trigger_run_id text,created_at timestamptz not null default now(),
 unique(owner_id,period)
);
alter table public.margin_report_triggers enable row level security;
revoke all on public.margin_report_triggers from public,anon,authenticated;
grant all on public.margin_report_triggers to service_role;
create or replace function public.margin_report_activate(p_owner uuid,p_policy text,p_run uuid,p_pdf text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.margin_report_plans p join public.utenti u on u.id=p.owner_id join public.ruoli r on r.id=u.ruolo_id
 where p.owner_id=p_owner and p.policy_hash=p_policy and u.attivo and r.amministratore_workspace for update of p;
 if not found then raise exception 'PLAN_NOT_AUTHORIZED';end if;
 perform 1 from public.margin_report_runs where id=p_run and owner_id=p_owner and policy_hash=p_policy and sha256=p_pdf and verified and status='staged' for update;
 if not found then raise exception 'PDF_CHANGED';end if;
 -- Explicit human review now includes the fixed published ChatGPT agent/channel.
 update public.margin_report_plans set enabled=true,approved_by=p_owner,approved_at=now(),agent_hash='a7bb56e2f563c69952464c80ee963158653cc21627994398900e49a77bf8f1ba' where owner_id=p_owner;
 update public.margin_report_runs set status='queued' where id=p_run;
 return true;
end $$;
revoke all on function public.margin_report_activate(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.margin_report_activate(uuid,text,uuid,text) to service_role;

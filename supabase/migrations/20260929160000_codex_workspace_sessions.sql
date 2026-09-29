begin;
create table public.ai_codex_sessions (
  conversation_id uuid primary key references public.ai_conversazioni(id) on delete cascade,
  user_id uuid not null references public.utenti(id),
  session_id text,
  configuration_hash text,
  updated_at timestamptz not null default now()
);
create table public.ai_codex_runs (
  id uuid primary key,
  conversation_id uuid not null references public.ai_codex_sessions(conversation_id) on delete cascade,
  user_id uuid not null references public.utenti(id),
  request jsonb not null,
  state text not null default 'pending' check (state in ('pending','completed','failed','cancelled')),
  phase text not null default 'new',
  session_id text,
  before_turn_id text,
  turn_id text,
  response jsonb,
  error text,
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ai_codex_one_pending on public.ai_codex_runs(conversation_id) where state='pending';
create table public.ai_codex_calls (
  run_id uuid not null references public.ai_codex_runs(id) on delete cascade,
  call_id text not null,
  turn_id text not null,
  name text not null,
  arguments jsonb not null,
  outcome jsonb,
  created_at timestamptz not null default now(),
  primary key(run_id,call_id)
);
alter table public.ai_codex_sessions enable row level security;
alter table public.ai_codex_runs enable row level security;
alter table public.ai_codex_calls enable row level security;
revoke all on public.ai_codex_sessions,public.ai_codex_runs,public.ai_codex_calls from anon,authenticated;
grant all on public.ai_codex_sessions,public.ai_codex_runs,public.ai_codex_calls to service_role;

create function public.start_workspace_codex_run(p_user uuid,p_conversation uuid,p_run uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r ai_codex_runs;
begin
 perform 1 from ai_conversazioni where id=p_conversation and utente_id=p_user for update;
 if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
 select * into r from ai_codex_runs where id=p_run;
 if found then
   if r.user_id<>p_user or r.conversation_id<>p_conversation then raise exception 'RUN_NOT_FOUND'; end if;
   return to_jsonb(r);
 end if;
 if exists(select 1 from ai_codex_runs where conversation_id=p_conversation and state='pending') then raise exception 'CODEX_ALREADY_RUNNING'; end if;
 insert into ai_codex_sessions(conversation_id,user_id) values(p_conversation,p_user) on conflict do nothing;
 insert into ai_codex_runs(id,conversation_id,user_id,request) values(p_run,p_conversation,p_user,p_request) returning * into r;
 insert into ai_messaggi(conversazione_id,ruolo,contenuto,fonti,metadati)
 values(p_conversation,'user',p_request->>'displayedPrompt','[]',jsonb_build_object('codexRunId',p_run,'attachments',p_request->'attachments'));
 update ai_conversazioni set aggiornata_il=now() where id=p_conversation;
 return to_jsonb(r);
end $$;

create function public.claim_workspace_codex_run(p_user uuid,p_run uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r ai_codex_runs;
begin
 update ai_codex_runs set lease_id=p_lease,lease_until=now()+interval '4 minutes',updated_at=now()
 where id=p_run and user_id=p_user and state='pending' and (lease_until is null or lease_until<now()) returning * into r;
 return case when found then to_jsonb(r) else null end;
end $$;

create function public.finish_workspace_codex_run(p_user uuid,p_run uuid,p_lease uuid,p_response jsonb,p_metadata jsonb,p_usage jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r ai_codex_runs;
begin
 select * into r from ai_codex_runs where id=p_run and user_id=p_user for update;
 if not found then raise exception 'RUN_NOT_FOUND'; end if;
 if r.state='completed' then return r.response; end if;
 if r.state<>'pending' or r.lease_id is distinct from p_lease or r.lease_until<now() then raise exception 'CODEX_LEASE_LOST'; end if;
 insert into ai_messaggi(id,conversazione_id,ruolo,contenuto,fonti,metadati)
 values(p_run,r.conversation_id,'assistant',p_response->>'answer',coalesce(p_response->'sources','[]'),p_metadata);
 insert into ai_generazioni(id,utente_id,conversazione_id,tipo,modello,stato,token_input,token_output,costo_usd,provider_request_id,metadati,completata_il)
 values(p_run,p_user,r.conversation_id,'chat_interna',p_metadata->>'model','completata',coalesce((p_usage->>'input')::bigint,0),coalesce((p_usage->>'output')::bigint,0),0,r.turn_id,
 jsonb_build_object('runtime','codex-agents','costSource','not_reported','usageAvailable',p_usage->'available'),now());
 perform workspace_record_ai_usage(p_user,coalesce((p_usage->>'input')::bigint,0),coalesce((p_usage->>'output')::bigint,0),0);
 update ai_codex_runs set state='completed',response=p_response,lease_id=null,lease_until=null,updated_at=now() where id=p_run;
 update ai_conversazioni set aggiornata_il=now() where id=r.conversation_id;
 return p_response;
end $$;
revoke all on function public.start_workspace_codex_run(uuid,uuid,uuid,jsonb),public.claim_workspace_codex_run(uuid,uuid,uuid),public.finish_workspace_codex_run(uuid,uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.start_workspace_codex_run(uuid,uuid,uuid,jsonb),public.claim_workspace_codex_run(uuid,uuid,uuid),public.finish_workspace_codex_run(uuid,uuid,uuid,jsonb,jsonb,jsonb) to service_role;
commit;

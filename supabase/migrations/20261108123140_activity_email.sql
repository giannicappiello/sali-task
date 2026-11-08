begin;
-- Capability definition only. No assignments to real users or roles.
insert into public.permessi(codice,descrizione,modulo)
values ('activity.email.send','Invia email dalle attività previa conferma','attivita') on conflict(codice) do nothing;

create table public.workspace_emails (
 id uuid primary key default gen_random_uuid(),
 task_id uuid not null references public.v4_fasi_progetto(id),
 author_id uuid not null default public.workspace_current_profile_id() references public.utenti(id),
 confirmed_by uuid references public.utenti(id),
 recipient text not null check(length(recipient)<=254 and recipient ~ '^[^[:space:]<>;,"@]+@[^[:space:]<>;,"@]+\.[^[:space:]<>;,"@]+$'),
 subject text not null check(length(btrim(subject)) between 1 and 200 and subject !~ '[[:cntrl:]]'),
 body text not null check(length(btrim(body)) between 1 and 12000),
 via_ai boolean not null default false,
 status text not null default 'proposed' check(status in ('proposed','queued','sending','accepted','failed','uncertain','rejected','cancelled')),
 idempotency_key text not null check(idempotency_key ~ '^[A-Za-z0-9:_-]{8,128}$'),
 task_snapshot jsonb not null,
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 confirmed_at timestamptz,
 claimed_at timestamptz,
 accepted_at timestamptz,
 provider_message_id text,
 error_code text,
 unique(author_id,idempotency_key),
 check(confirmed_by is null or confirmed_by=author_id)
);
create index workspace_emails_task_history on public.workspace_emails(task_id,created_at desc,id desc);
create index workspace_emails_queue on public.workspace_emails(created_at) where status='queued';
-- Attempt tokens are deliberately outside the user-readable history.
create table public.workspace_email_delivery (
 email_id uuid primary key references public.workspace_emails(id),
 worker_id text not null,
 lock_token uuid not null default gen_random_uuid()
);
alter table public.workspace_emails enable row level security;
alter table public.workspace_email_delivery enable row level security;
revoke all on public.workspace_emails,public.workspace_email_delivery from public,anon,authenticated;
grant select on public.workspace_emails to authenticated;
grant insert(task_id,recipient,subject,body,idempotency_key,via_ai) on public.workspace_emails to authenticated;
grant update(status) on public.workspace_emails to authenticated;
grant select,insert,update on public.workspace_emails,public.workspace_email_delivery to service_role;

-- Narrow self-only privileged lookup: permission tables need not be exposed.
create schema if not exists workspace_email_private;
revoke all on schema workspace_email_private from public,anon;
grant usage on schema workspace_email_private to authenticated;
create or replace function workspace_email_private.can_send()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.utenti u join public.ruoli r on r.id=u.ruolo_id
 where u.auth_user_id=auth.uid() and u.attivo is not false and (
 r.amministratore_workspace is true or (
 not exists(select 1 from public.workspace_eccezioni_utente e where e.utente_id=u.id and e.ambito='permesso'
   and e.codice='activity.email.send' and e.decisione='nega' and (e.valida_fino_a is null or e.valida_fino_a>now()))
 and (exists(select 1 from public.permessi_utente pu join public.permessi p on p.id=pu.permesso_id where pu.utente_id=u.id and p.codice='activity.email.send')
 or exists(select 1 from public.permessi_ruolo pr join public.permessi p on p.id=pr.permesso_id where pr.ruolo_id=u.ruolo_id and p.codice='activity.email.send')
 or exists(select 1 from public.workspace_eccezioni_utente e where e.utente_id=u.id and e.ambito='permesso'
   and e.codice='activity.email.send' and e.decisione='consenti' and (e.valida_fino_a is null or e.valida_fino_a>now())))
 )))
$$;
revoke all on function workspace_email_private.can_send() from public,anon,authenticated;
grant execute on function workspace_email_private.can_send() to authenticated;
create or replace function public.workspace_activity_email_permission()
returns boolean language sql stable security invoker set search_path='' as $$
 select workspace_email_private.can_send()
$$;
create or replace function public.workspace_activity_email_can_write(p_task uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select public.workspace_current_profile_id() is not null
 and not public.workspace_customer_record_scope()
 and public.workspace_activity_email_permission()
 and (public.workspace_user_is_admin() or coalesce(public.workspace_access_context()->'module_levels'->>'attivita','nessuno') in ('scrittura','amministrazione'))
 and p_task=any(public.workspace_direct_phase_ids())
 and exists(select 1 from public.v4_fasi_progetto t where t.id=p_task)
$$;
create policy workspace_email_read on public.workspace_emails for select to authenticated
 using(exists(select 1 from public.v4_fasi_progetto t where t.id=task_id));
create policy workspace_email_propose on public.workspace_emails for insert to authenticated
 with check(author_id=public.workspace_current_profile_id() and status='proposed' and public.workspace_activity_email_can_write(task_id));
create policy workspace_email_decide on public.workspace_emails for update to authenticated
 using(author_id=public.workspace_current_profile_id() and status='proposed' and public.workspace_activity_email_can_write(task_id))
 with check(author_id=public.workspace_current_profile_id() and status in ('queued','rejected','cancelled') and public.workspace_activity_email_can_write(task_id));

-- Defense in depth for direct PostgREST writes, not only application RPC calls.
create or replace function public.workspace_guard_activity_email()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_snapshot jsonb; v_user uuid;
begin
 if tg_op='UPDATE' then
  if (to_jsonb(new)-array['status','confirmed_by','confirmed_at','claimed_at','accepted_at','provider_message_id','error_code'])
    is distinct from (to_jsonb(old)-array['status','confirmed_by','confirmed_at','claimed_at','accepted_at','provider_message_id','error_code']) then
   raise exception 'IMMUTABLE_EMAIL_PROPOSAL';
  end if;
  if current_user='service_role' then
   if not ((old.status='queued' and new.status in ('sending','cancelled')) or (old.status='sending' and new.status in ('accepted','failed','uncertain'))) then
    raise exception 'INVALID_EMAIL_TRANSITION';
   end if;
   return new;
  end if;
  if old.status<>'proposed' or new.status not in ('queued','rejected','cancelled') then raise exception 'INVALID_EMAIL_TRANSITION'; end if;
 end if;
 v_user:=public.workspace_current_profile_id();
 if v_user is null or not public.workspace_activity_email_can_write(new.task_id) then raise exception 'EMAIL_PERMISSION_REQUIRED' using errcode='42501'; end if;
 if tg_op='INSERT' then
  if new.author_id is distinct from v_user or new.status<>'proposed' then raise exception 'FORBIDDEN'; end if;
 else
  if old.author_id is distinct from v_user then raise exception 'FORBIDDEN'; end if;
 end if;
 if new.via_ai then
  if not public.second_brain_enabled() or not (coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]'::jsonb) ? 'attivita')
   or (tg_op='INSERT' and not public.workspace_ai_can_propose())
   or (tg_op='UPDATE' and new.status='queued' and not public.workspace_ai_can_confirm()) then raise exception 'AI_EMAIL_PERMISSION_REQUIRED' using errcode='42501'; end if;
 end if;
 select to_jsonb(t) into v_snapshot from public.v4_fasi_progetto t where t.id=new.task_id for share;
 if v_snapshot is null then raise exception 'TASK_NOT_ACCESSIBLE'; end if;
 if tg_op='INSERT' then
  new.created_at:=now(); new.confirmed_by:=null; new.confirmed_at:=null;
  new.task_snapshot:=v_snapshot;
  new.payload_hash:=encode(sha256(convert_to(jsonb_build_object('task',new.task_id,'author',new.author_id,'recipient',new.recipient,
    'subject',new.subject,'body',new.body,'viaAI',new.via_ai,'snapshot',v_snapshot)::text,'UTF8')),'hex');
 else
  if new.status='queued' then
   if old.created_at<now()-interval '30 minutes' then raise exception 'EMAIL_PROPOSAL_EXPIRED'; end if;
   if v_snapshot is distinct from old.task_snapshot then raise exception 'TASK_CHANGED'; end if;
  end if;
  new.confirmed_by:=v_user; new.confirmed_at:=now();
 end if;
 return new;
end $$;
create trigger workspace_guard_activity_email before insert or update on public.workspace_emails
 for each row execute function public.workspace_guard_activity_email();

create or replace function public.workspace_activity_email_context(p_task uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_task jsonb; v_allowed boolean;
begin
 select to_jsonb(t) into v_task from public.v4_fasi_progetto t where t.id=p_task;
 if v_task is null then raise exception 'TASK_NOT_ACCESSIBLE'; end if;
 v_allowed:=public.workspace_activity_email_can_write(p_task);
 return jsonb_build_object('task',v_task,'permissions',jsonb_build_object('canPropose',v_allowed,'canConfirm',v_allowed));
end $$;
create or replace function public.workspace_propose_activity_email(p_task uuid,p_recipient text,p_subject text,p_body text,p_idempotency_key text,p_via_ai boolean default false)
returns public.workspace_emails language plpgsql security invoker set search_path='' as $$
declare v_row public.workspace_emails;
begin
 if not public.workspace_activity_email_can_write(p_task) then raise exception 'EMAIL_PERMISSION_REQUIRED' using errcode='42501'; end if;
 if p_via_ai and (not public.second_brain_enabled() or not public.workspace_ai_can_propose()
  or not (coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]'::jsonb) ? 'attivita')) then raise exception 'AI_EMAIL_PERMISSION_REQUIRED'; end if;
 insert into public.workspace_emails(task_id,recipient,subject,body,idempotency_key,via_ai)
 values(p_task,p_recipient,p_subject,p_body,p_idempotency_key,p_via_ai)
 on conflict(author_id,idempotency_key) do nothing returning * into v_row;
 if v_row.id is null then
  select * into v_row from public.workspace_emails where author_id=public.workspace_current_profile_id() and idempotency_key=p_idempotency_key;
  if v_row.id is null or v_row.task_id is distinct from p_task or v_row.recipient is distinct from p_recipient or v_row.subject is distinct from p_subject
   or v_row.body is distinct from p_body or v_row.via_ai is distinct from p_via_ai then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 end if;
 return v_row;
end $$;
create or replace function public.workspace_decide_activity_email(p_id uuid,p_confirm boolean,p_expected_hash text)
returns public.workspace_emails language plpgsql security invoker set search_path='' as $$
declare v_row public.workspace_emails;
begin
 if p_confirm is null or p_expected_hash is null then raise exception 'EXPLICIT_EMAIL_DECISION_REQUIRED'; end if;
 select * into v_row from public.workspace_emails where id=p_id and author_id=public.workspace_current_profile_id();
 if v_row.id is null then raise exception 'EMAIL_NOT_ACCESSIBLE'; end if;
 if not public.workspace_activity_email_can_write(v_row.task_id) then raise exception 'EMAIL_PERMISSION_REQUIRED'; end if;
 if v_row.payload_hash is distinct from p_expected_hash then raise exception 'EMAIL_CHANGED'; end if;
 if v_row.via_ai and (not public.second_brain_enabled() or not (coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]'::jsonb) ? 'attivita')
   or (p_confirm and not public.workspace_ai_can_confirm())) then raise exception 'AI_EMAIL_PERMISSION_REQUIRED'; end if;
 -- Repeated confirmation is idempotent, never requeues a delivery attempt.
 if v_row.status<>'proposed' then return v_row; end if;
 update public.workspace_emails set status=case when p_confirm then 'queued' else 'rejected' end where id=p_id returning * into v_row;
 if v_row.id is null then
  select * into v_row from public.workspace_emails where id=p_id and author_id=public.workspace_current_profile_id();
  if v_row.id is null then raise exception 'EMAIL_NOT_ACCESSIBLE'; end if;
 end if;
 return v_row;
end $$;

create or replace function public.workspace_claim_email(p_worker text)
returns setof jsonb language plpgsql security invoker set search_path='' as $$
declare v_row public.workspace_emails; v_lock uuid;
begin
 if length(btrim(p_worker)) not between 1 and 128 then raise exception 'INVALID_WORKER'; end if;
 select * into v_row from public.workspace_emails where status='queued' order by created_at,id for update skip locked limit 1;
 if v_row.id is null then return; end if;
 -- One permanent attempt. Crash or lost acknowledgement never returns to queued.
 update public.workspace_emails set status='sending',claimed_at=now() where id=v_row.id returning * into v_row;
 insert into public.workspace_email_delivery(email_id,worker_id) values(v_row.id,p_worker) returning lock_token into v_lock;
 return next to_jsonb(v_row)||jsonb_build_object('lock_token',v_lock,'worker_id',p_worker);
end $$;
create or replace function public.workspace_finish_email(p_id uuid,p_lock_token uuid,p_status text,p_provider_message_id text default null,p_error_code text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_count integer;
begin
 if p_status is null or p_status not in ('accepted','failed','uncertain') then raise exception 'INVALID_EMAIL_OUTCOME'; end if;
 if p_error_code is not null and p_error_code !~ '^[A-Za-z0-9_:-]{1,100}$' then raise exception 'INVALID_ERROR_CODE'; end if;
 update public.workspace_emails e set status=p_status,provider_message_id=left(p_provider_message_id,300),error_code=p_error_code,
  accepted_at=case when p_status='accepted' then now() else null end
 where e.id=p_id and e.status='sending' and exists(select 1 from public.workspace_email_delivery d where d.email_id=e.id and d.lock_token=p_lock_token);
 get diagnostics v_count=row_count;
 return v_count=1;
end $$;
create or replace function public.workspace_expire_email_claims()
returns integer language plpgsql security invoker set search_path='' as $$
declare v_count integer;
begin
 update public.workspace_emails set status='uncertain',error_code='CLAIM_TIMEOUT'
 where status='sending' and claimed_at<now()-interval '10 minutes';
 get diagnostics v_count=row_count;
 return v_count;
end $$;
revoke all on function public.workspace_activity_email_permission(),public.workspace_activity_email_can_write(uuid),public.workspace_guard_activity_email(),public.workspace_activity_email_context(uuid),public.workspace_propose_activity_email(uuid,text,text,text,text,boolean),public.workspace_decide_activity_email(uuid,boolean,text),public.workspace_claim_email(text),public.workspace_finish_email(uuid,uuid,text,text,text),public.workspace_expire_email_claims() from public,anon,authenticated;
grant execute on function public.workspace_activity_email_permission(),public.workspace_activity_email_can_write(uuid),public.workspace_activity_email_context(uuid),public.workspace_propose_activity_email(uuid,text,text,text,text,boolean),public.workspace_decide_activity_email(uuid,boolean,text) to authenticated;
grant execute on function public.workspace_claim_email(text),public.workspace_finish_email(uuid,uuid,text,text,text) ,public.workspace_expire_email_claims() to service_role;
notify pgrst,'reload schema';
commit;

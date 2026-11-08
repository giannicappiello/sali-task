begin;
-- This migration defines a capability, never grants it to a real user or role.
insert into public.permessi(codice,descrizione,modulo) values
 ('workspace.email.send','Invia singole email testuali richieste in chat','assistente_ai') on conflict(codice) do nothing;

create or replace function workspace_email_private.chat_policy()
returns jsonb language sql immutable security invoker set search_path='' as $$
 select '{"version":"chat-email-v1","scope":"Solo singole email testuali richieste esplicitamente in chat dal titolare, al destinatario specifico indicato nella richiesta. Nessun allegato, invio ricorrente o massivo.","explicit_user_request_required":true,"specific_recipient_required":true,"single_recipient":true,"plain_text_only":true,"attachments":false,"recurring":false,"bulk":false}'::jsonb
$$;
create table public.workspace_email_delegations (
 id uuid primary key default gen_random_uuid(),
 author_id uuid not null references public.utenti(id),
 policy_version text not null default 'chat-email-v1' check(policy_version='chat-email-v1'),
 policy jsonb not null,
 policy_hash text not null check(policy_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'proposed' check(status in ('proposed','active','revoked')),
 created_at timestamptz not null default now(),
 approved_by uuid references public.utenti(id), approved_at timestamptz,
 revoked_by uuid references public.utenti(id), revoked_at timestamptz,
 approval_method text,
 check(approved_by is null or approved_by=author_id),
 check(revoked_by is null or revoked_by=author_id),
 check(status<>'active' or (approved_by=author_id and approved_at is not null and approval_method='workspace-human-receipt-v1'))
);
create unique index workspace_email_delegation_current on public.workspace_email_delegations(author_id) where status in ('proposed','active');
alter table public.workspace_email_delegations enable row level security;
revoke all on public.workspace_email_delegations from public,anon,authenticated;
grant select on public.workspace_email_delegations to authenticated;
grant select,insert,update on public.workspace_email_delegations to service_role;
grant usage on schema workspace_email_private to service_role;

alter table public.workspace_emails alter column task_id drop not null;
alter table public.workspace_emails add column source_kind text not null default 'activity' check(source_kind in ('activity','chat'));
alter table public.workspace_emails add column delegation_id uuid references public.workspace_email_delegations(id);
alter table public.workspace_emails add column delegation_policy_hash text;
alter table public.workspace_emails add column delegation_policy_version text;
alter table public.workspace_emails add constraint workspace_email_source_task check((source_kind='activity' and task_id is not null) or (source_kind='chat' and task_id is null));
alter table public.workspace_emails add constraint workspace_email_delegation_snapshot check(
 (delegation_id is null and delegation_policy_hash is null and delegation_policy_version is null)
 or (source_kind='chat' and delegation_id is not null and delegation_policy_hash ~ '^[a-f0-9]{64}$' and delegation_policy_version='chat-email-v1')
);
create index workspace_emails_chat_history on public.workspace_emails(author_id,created_at desc,id desc) where source_kind='chat';

-- Arbitrary actor lookup is private and callable only by trusted backend/worker.
create or replace function workspace_email_private.chat_permission_for(p_actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.utenti u join public.ruoli r on r.id=u.ruolo_id where u.id=p_actor and u.attivo is not false
 and (r.amministratore_workspace is true or (
 not exists(select 1 from public.workspace_eccezioni_utente e where e.utente_id=u.id and e.ambito='permesso' and e.codice='workspace.email.send' and e.decisione='nega' and (e.valida_fino_a is null or e.valida_fino_a>now()))
 and (exists(select 1 from public.permessi_utente pu join public.permessi p on p.id=pu.permesso_id where pu.utente_id=u.id and p.codice='workspace.email.send')
 or exists(select 1 from public.permessi_ruolo pr join public.permessi p on p.id=pr.permesso_id where pr.ruolo_id=u.ruolo_id and p.codice='workspace.email.send')
 or exists(select 1 from public.workspace_eccezioni_utente e where e.utente_id=u.id and e.ambito='permesso' and e.codice='workspace.email.send' and e.decisione='consenti' and (e.valida_fino_a is null or e.valida_fino_a>now())))
 )))
$$;
create or replace function workspace_email_private.chat_self_permission()
returns boolean language sql stable security definer set search_path='' as $$
 select public.workspace_current_profile_id() is not null and workspace_email_private.chat_permission_for(public.workspace_current_profile_id())
$$;
create or replace function public.workspace_chat_email_permission()
returns boolean language sql stable security invoker set search_path='' as $$select workspace_email_private.chat_self_permission()$$;
create policy workspace_email_delegation_read on public.workspace_email_delegations for select to authenticated
 using(author_id=public.workspace_current_profile_id() and public.workspace_chat_email_permission());
create policy workspace_chat_email_read on public.workspace_emails for select to authenticated
 using(source_kind='chat' and author_id=public.workspace_current_profile_id() and public.workspace_chat_email_permission());
-- No authenticated INSERT/UPDATE policies for chat or delegation. Existing
-- activity policies require a writable non-null task and cannot match chat.

create or replace function workspace_email_private.guard_delegation()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not pg_has_role(current_user,'service_role','USAGE') then raise exception 'HUMAN_BACKEND_REQUIRED'; end if;
 if tg_op='INSERT' then
  if new.status<>'proposed' or new.approved_by is not null or new.approved_at is not null or new.revoked_by is not null or new.revoked_at is not null or new.approval_method is not null then raise exception 'DELEGATION_MUST_BE_PROPOSED'; end if;
  new.policy:=workspace_email_private.chat_policy(); new.policy_version:='chat-email-v1'; new.created_at:=now();
  new.policy_hash:=encode(sha256(convert_to(jsonb_build_object('id',new.id,'author',new.author_id,'version',new.policy_version,'policy',new.policy)::text,'UTF8')),'hex');
 else
  if (to_jsonb(new)-array['status','approved_by','approved_at','revoked_by','revoked_at','approval_method']) is distinct from
     (to_jsonb(old)-array['status','approved_by','approved_at','revoked_by','revoked_at','approval_method']) then raise exception 'IMMUTABLE_EMAIL_DELEGATION'; end if;
  if not ((old.status='proposed' and new.status in ('active','revoked')) or (old.status='active' and new.status='revoked')) then raise exception 'EMAIL_DELEGATION_CHANGED'; end if;
  if new.status='active' and (new.approved_by is distinct from new.author_id or new.approved_at is null or new.approval_method is distinct from 'workspace-human-receipt-v1') then raise exception 'HUMAN_APPROVAL_REQUIRED'; end if;
  if new.status='revoked' and (new.revoked_by is distinct from new.author_id or new.revoked_at is null) then raise exception 'HUMAN_APPROVAL_REQUIRED'; end if;
 end if;
 return new;
end $$;
create trigger workspace_email_delegation_guard before insert or update on public.workspace_email_delegations for each row execute function workspace_email_private.guard_delegation();

-- Keep the prior activity guard intact except for dispatch to the independent
-- chat guard below. Its invoker RLS checks must not become SECURITY DEFINER.
do $$
declare v_definition text;
begin
 select pg_get_functiondef('public.workspace_guard_activity_email()'::regprocedure) into v_definition;
 v_definition:=regexp_replace(v_definition,'\mbegin\M',E'begin\n if new.source_kind=''chat'' then return new; end if;');
 execute v_definition;
end $$;
create or replace function workspace_email_private.guard_chat_email()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.source_kind<>'chat' then return new; end if;
 if not pg_has_role(current_user,'service_role','USAGE') then raise exception 'CHAT_EMAIL_RPC_REQUIRED'; end if;
 if tg_op='INSERT' then
  if new.status<>'proposed' or new.task_id is not null or not new.via_ai or new.delegation_id is not null then raise exception 'INVALID_CHAT_EMAIL_PROPOSAL'; end if;
  new.created_at:=now(); new.task_snapshot:='{}'::jsonb; new.confirmed_by:=null; new.confirmed_at:=null;
  new.payload_hash:=encode(sha256(convert_to(jsonb_build_object('source','chat','author',new.author_id,'recipient',new.recipient,'subject',new.subject,'body',new.body)::text,'UTF8')),'hex');
 else
  if (to_jsonb(new)-array['status','confirmed_by','confirmed_at','claimed_at','accepted_at','provider_message_id','error_code','delegation_id','delegation_policy_hash','delegation_policy_version'])
    is distinct from (to_jsonb(old)-array['status','confirmed_by','confirmed_at','claimed_at','accepted_at','provider_message_id','error_code','delegation_id','delegation_policy_hash','delegation_policy_version']) then raise exception 'IMMUTABLE_EMAIL_PROPOSAL'; end if;
  if not ((old.status='proposed' and new.status in ('queued','rejected','cancelled')) or (old.status='queued' and new.status in ('sending','cancelled')) or (old.status='sending' and new.status in ('accepted','failed','uncertain'))) then raise exception 'INVALID_EMAIL_TRANSITION'; end if;
  if old.status<>'proposed' and row(new.delegation_id,new.delegation_policy_hash,new.delegation_policy_version,new.confirmed_by,new.confirmed_at) is distinct from row(old.delegation_id,old.delegation_policy_hash,old.delegation_policy_version,old.confirmed_by,old.confirmed_at) then raise exception 'IMMUTABLE_EMAIL_AUTHORIZATION'; end if;
  if new.status='queued' and (new.confirmed_by is distinct from new.author_id or new.confirmed_at is null) then raise exception 'EMAIL_CONFIRMATION_REQUIRED'; end if;
 end if;
 return new;
end $$;
create trigger workspace_chat_email_guard before insert or update on public.workspace_emails for each row execute function workspace_email_private.guard_chat_email();

create or replace function workspace_email_private.chat_capability()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=public.workspace_current_profile_id(); v_permission boolean; v_prepare boolean; v_confirm boolean; v_delegation public.workspace_email_delegations;
begin
 v_permission:=v_user is not null and workspace_email_private.chat_permission_for(v_user);
 v_prepare:=v_permission and public.second_brain_enabled() and public.workspace_ai_can_propose();
 v_confirm:=v_permission and public.second_brain_enabled() and public.workspace_ai_can_confirm();
 if v_permission then select * into v_delegation from public.workspace_email_delegations where author_id=v_user and status in ('proposed','active') and policy_version='chat-email-v1' and policy=workspace_email_private.chat_policy(); end if;
 return jsonb_build_object('enabled',v_permission,'canPrepare',v_prepare,'canConfirm',v_confirm,'canSend',v_confirm and coalesce(v_delegation.status='active',false),
 'requiresDelegation',v_delegation.id is null or v_delegation.status<>'active','delegation',case when v_delegation.id is null then null else to_jsonb(v_delegation) end,'policyVersion','chat-email-v1','scope',workspace_email_private.chat_policy());
end $$;
create or replace function public.workspace_chat_email_capability()
returns jsonb language sql stable security invoker set search_path='' as $$select workspace_email_private.chat_capability()$$;

create or replace function workspace_email_private.prepare_chat(p_recipient text,p_subject text,p_body text,p_idempotency_key text)
returns public.workspace_emails language plpgsql security definer set search_path='' as $$
declare v_user uuid:=public.workspace_current_profile_id(); v_row public.workspace_emails;
begin
 if v_user is null or not workspace_email_private.chat_permission_for(v_user) then raise exception 'EMAIL_PERMISSION_REQUIRED'; end if;
 if not public.second_brain_enabled() or not public.workspace_ai_can_propose() then raise exception 'AI_EMAIL_PERMISSION_REQUIRED'; end if;
 insert into public.workspace_emails(author_id,source_kind,task_id,recipient,subject,body,idempotency_key,via_ai)
 values(v_user,'chat',null,p_recipient,p_subject,p_body,p_idempotency_key,true)
 on conflict(author_id,idempotency_key) do nothing returning * into v_row;
 if v_row.id is null then
  select * into v_row from public.workspace_emails where author_id=v_user and idempotency_key=p_idempotency_key;
  if v_row.id is null or v_row.source_kind<>'chat' or v_row.recipient is distinct from p_recipient or v_row.subject is distinct from p_subject or v_row.body is distinct from p_body then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 end if;
 return v_row;
end $$;
create or replace function public.workspace_prepare_chat_email(p_recipient text,p_subject text,p_body text,p_idempotency_key text)
returns public.workspace_emails language sql security invoker set search_path='' as $$select workspace_email_private.prepare_chat(p_recipient,p_subject,p_body,p_idempotency_key)$$;

create or replace function workspace_email_private.propose_delegation()
returns public.workspace_email_delegations language plpgsql security definer set search_path='' as $$
declare v_user uuid:=public.workspace_current_profile_id(); v_row public.workspace_email_delegations;
begin
 if v_user is null or not workspace_email_private.chat_permission_for(v_user) then raise exception 'EMAIL_PERMISSION_REQUIRED'; end if;
 if not public.second_brain_enabled() or not public.workspace_ai_can_propose() then raise exception 'AI_EMAIL_PERMISSION_REQUIRED'; end if;
 -- Serialize proposals per owner, including the empty-set first proposal.
 perform pg_advisory_xact_lock(hashtextextended('email-delegation:'||v_user::text,0));
 select * into v_row from public.workspace_email_delegations where author_id=v_user and status in ('proposed','active');
 if v_row.id is not null then return v_row; end if;
 insert into public.workspace_email_delegations(author_id) values(v_user) returning * into v_row;
 return v_row;
end $$;
create or replace function public.workspace_propose_email_delegation()
returns public.workspace_email_delegations language sql security invoker set search_path='' as $$select workspace_email_private.propose_delegation()$$;

create or replace function workspace_email_private.send_chat(p_id uuid,p_expected_hash text)
returns public.workspace_emails language plpgsql security definer set search_path='' as $$
declare v_user uuid:=public.workspace_current_profile_id(); v_row public.workspace_emails; v_delegation public.workspace_email_delegations;
begin
 if v_user is null or not workspace_email_private.chat_permission_for(v_user) then raise exception 'EMAIL_PERMISSION_REQUIRED'; end if;
 if not public.second_brain_enabled() or not public.workspace_ai_can_confirm() then raise exception 'AI_EMAIL_PERMISSION_REQUIRED'; end if;
 select * into v_row from public.workspace_emails where id=p_id and author_id=v_user and source_kind='chat' for update;
 if v_row.id is null then raise exception 'EMAIL_NOT_ACCESSIBLE'; end if;
 if p_expected_hash is null or v_row.payload_hash is distinct from p_expected_hash then raise exception 'EMAIL_CHANGED'; end if;
 if v_row.status<>'proposed' then return v_row; end if;
 if v_row.created_at<now()-interval '30 minutes' then raise exception 'EMAIL_PROPOSAL_EXPIRED'; end if;
 select * into v_delegation from public.workspace_email_delegations where author_id=v_user and status='active' and policy_version='chat-email-v1' and policy=workspace_email_private.chat_policy() for share;
 if v_delegation.id is null then raise exception 'EMAIL_DELEGATION_REQUIRED'; end if;
 update public.workspace_emails set status='queued',confirmed_by=v_user,confirmed_at=now(),delegation_id=v_delegation.id,
 delegation_policy_hash=v_delegation.policy_hash,delegation_policy_version=v_delegation.policy_version where id=v_row.id returning * into v_row;
 return v_row;
end $$;
create or replace function public.workspace_send_chat_email(p_id uuid,p_expected_hash text)
returns public.workspace_emails language sql security invoker set search_path='' as $$select workspace_email_private.send_chat(p_id,p_expected_hash)$$;

-- Only trusted human-review backend may evaluate another actor. JWT context is
-- transaction-local and restored; actor is the verified profile, never input.
create or replace function workspace_email_private.actor_ai_confirm(p_actor uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_auth uuid; v_sub text:=current_setting('request.jwt.claim.sub',true); v_claims text:=current_setting('request.jwt.claims',true); v_allowed boolean;
begin
 select auth_user_id into v_auth from public.utenti where id=p_actor and attivo is not false;
 if v_auth is null then return false; end if;
 perform set_config('request.jwt.claim.sub',v_auth::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_auth,'role','authenticated')::text,true);
 v_allowed:=public.second_brain_enabled() and public.workspace_ai_can_confirm();
 perform set_config('request.jwt.claim.sub',coalesce(v_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
 return v_allowed;
end $$;
create or replace function workspace_email_private.decide_delegation(p_actor uuid,p_id uuid,p_confirm boolean,p_expected_hash text)
returns public.workspace_email_delegations language plpgsql security definer set search_path='' as $$
declare v_row public.workspace_email_delegations;
begin
 if p_actor is null or p_confirm is null then raise exception 'EXPLICIT_EMAIL_DECISION_REQUIRED'; end if;
 select * into v_row from public.workspace_email_delegations where id=p_id and author_id=p_actor for update;
 if v_row.id is null then raise exception 'EMAIL_NOT_ACCESSIBLE'; end if;
 if p_expected_hash is null or v_row.policy_hash is distinct from p_expected_hash or v_row.policy_version<>'chat-email-v1' or v_row.policy is distinct from workspace_email_private.chat_policy() then raise exception 'EMAIL_DELEGATION_CHANGED'; end if;
 if p_confirm then
  if not workspace_email_private.chat_permission_for(p_actor) or not workspace_email_private.actor_ai_confirm(p_actor) then raise exception 'EMAIL_PERMISSION_REQUIRED'; end if;
  if v_row.status='active' then return v_row; end if;
  if v_row.status<>'proposed' then raise exception 'EMAIL_DELEGATION_CHANGED'; end if;
  if v_row.created_at<now()-interval '30 minutes' then raise exception 'EMAIL_PROPOSAL_EXPIRED'; end if;
  update public.workspace_email_delegations set status='active',approved_by=p_actor,approved_at=now(),approval_method='workspace-human-receipt-v1' where id=p_id returning * into v_row;
 else
  if v_row.status='revoked' then return v_row; end if;
  update public.workspace_email_delegations set status='revoked',revoked_by=p_actor,revoked_at=now() where id=p_id returning * into v_row;
 end if;
 return v_row;
end $$;
create or replace function public.workspace_decide_email_delegation(p_actor uuid,p_id uuid,p_confirm boolean,p_expected_hash text)
returns public.workspace_email_delegations language sql security invoker set search_path='' as $$select workspace_email_private.decide_delegation(p_actor,p_id,p_confirm,p_expected_hash)$$;
create or replace function workspace_email_private.decide_chat_human(p_actor uuid,p_id uuid,p_confirm boolean,p_expected_hash text)
returns public.workspace_emails language plpgsql security definer set search_path='' as $$
declare v_row public.workspace_emails;
begin
 if p_actor is null or p_confirm is null then raise exception 'EXPLICIT_EMAIL_DECISION_REQUIRED'; end if;
 if not workspace_email_private.chat_permission_for(p_actor) then raise exception 'EMAIL_PERMISSION_REQUIRED'; end if;
 select * into v_row from public.workspace_emails where id=p_id and author_id=p_actor and source_kind='chat' for update;
 if v_row.id is null then raise exception 'EMAIL_NOT_ACCESSIBLE'; end if;
 if p_expected_hash is null or v_row.payload_hash is distinct from p_expected_hash then raise exception 'EMAIL_CHANGED'; end if;
 if p_confirm and not workspace_email_private.actor_ai_confirm(p_actor) then raise exception 'AI_EMAIL_PERMISSION_REQUIRED'; end if;
 if v_row.status<>'proposed' then return v_row; end if;
 if p_confirm and v_row.created_at<now()-interval '30 minutes' then raise exception 'EMAIL_PROPOSAL_EXPIRED'; end if;
 update public.workspace_emails set status=case when p_confirm then 'queued' else 'rejected' end,confirmed_by=p_actor,confirmed_at=now() where id=p_id returning * into v_row;
 return v_row;
end $$;
create or replace function public.workspace_decide_chat_email_human(p_actor uuid,p_id uuid,p_confirm boolean,p_expected_hash text)
returns public.workspace_emails language sql security invoker set search_path='' as $$select workspace_email_private.decide_chat_human(p_actor,p_id,p_confirm,p_expected_hash)$$;

-- Same transport contract. A revoked or changed delegation cancels queued work,
-- never retries it. A claim already in sending cannot be recalled safely.
create or replace function public.workspace_claim_email(p_worker text)
returns setof jsonb language plpgsql security invoker set search_path='' as $$
declare v_row public.workspace_emails; v_lock uuid; v_delegation public.workspace_email_delegations; v_valid boolean; i integer;
begin
 if p_worker is null or length(btrim(p_worker)) not between 1 and 128 then raise exception 'INVALID_WORKER'; end if;
 for i in 1..20 loop
  select * into v_row from public.workspace_emails where status='queued' order by created_at,id for update skip locked limit 1;
  if v_row.id is null then return; end if;
  v_valid:=true;
  if v_row.source_kind='chat' then
   v_valid:=workspace_email_private.chat_permission_for(v_row.author_id) and workspace_email_private.actor_ai_confirm(v_row.author_id);
   if v_row.delegation_id is not null then
    select * into v_delegation from public.workspace_email_delegations where id=v_row.delegation_id for share;
    v_valid:=v_valid and v_delegation.id is not null and v_delegation.author_id=v_row.author_id and v_delegation.status='active'
      and v_delegation.policy_hash=v_row.delegation_policy_hash and v_delegation.policy_version=v_row.delegation_policy_version
      and v_delegation.policy_version='chat-email-v1' and v_delegation.policy=workspace_email_private.chat_policy();
   end if;
  end if;
  if not coalesce(v_valid,false) then
   update public.workspace_emails set status='cancelled',error_code='EMAIL_AUTHORIZATION_REVOKED' where id=v_row.id;
   continue;
  end if;
  update public.workspace_emails set status='sending',claimed_at=now() where id=v_row.id returning * into v_row;
  insert into public.workspace_email_delivery(email_id,worker_id) values(v_row.id,p_worker) returning lock_token into v_lock;
  return next to_jsonb(v_row)||jsonb_build_object('lock_token',v_lock,'worker_id',p_worker);
  return;
 end loop;
end $$;

revoke all on function workspace_email_private.chat_policy(),workspace_email_private.chat_permission_for(uuid),workspace_email_private.chat_self_permission(),workspace_email_private.guard_delegation(),workspace_email_private.guard_chat_email(),workspace_email_private.chat_capability(),workspace_email_private.prepare_chat(text,text,text,text),workspace_email_private.propose_delegation(),workspace_email_private.send_chat(uuid,text),workspace_email_private.actor_ai_confirm(uuid),workspace_email_private.decide_delegation(uuid,uuid,boolean,text),workspace_email_private.decide_chat_human(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function workspace_email_private.chat_self_permission(),workspace_email_private.chat_capability(),workspace_email_private.prepare_chat(text,text,text,text),workspace_email_private.propose_delegation(),workspace_email_private.send_chat(uuid,text) to authenticated;
grant execute on function workspace_email_private.chat_policy(),workspace_email_private.chat_permission_for(uuid),workspace_email_private.actor_ai_confirm(uuid),workspace_email_private.decide_delegation(uuid,uuid,boolean,text),workspace_email_private.decide_chat_human(uuid,uuid,boolean,text) to service_role;
revoke all on function public.workspace_chat_email_permission(),public.workspace_chat_email_capability(),public.workspace_prepare_chat_email(text,text,text,text),public.workspace_propose_email_delegation(),public.workspace_send_chat_email(uuid,text),public.workspace_decide_email_delegation(uuid,uuid,boolean,text),public.workspace_decide_chat_email_human(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.workspace_chat_email_permission(),public.workspace_chat_email_capability(),public.workspace_prepare_chat_email(text,text,text,text),public.workspace_propose_email_delegation(),public.workspace_send_chat_email(uuid,text) to authenticated;
grant execute on function public.workspace_decide_email_delegation(uuid,uuid,boolean,text),public.workspace_decide_chat_email_human(uuid,uuid,boolean,text) to service_role;
notify pgrst,'reload schema';
commit;

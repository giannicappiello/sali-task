begin;
-- Additive recipient protocol. Do not backfill arrays or rewrite historic hashes,
-- receipts, delegations, queued attempts, or the legacy recipient address.
alter table public.workspace_emails add column transport_protocol_version smallint not null default 1;
alter table public.workspace_emails add column to_recipients text[];
alter table public.workspace_emails add column cc_recipients text[];
alter table public.workspace_emails add constraint workspace_email_recipient_protocol check(
 (transport_protocol_version=1 and to_recipients is null and cc_recipients is null)
 or (transport_protocol_version=2 and to_recipients is not null and cc_recipients is not null
 and cardinality(to_recipients) between 1 and 10 and cardinality(to_recipients)+cardinality(cc_recipients)<=10
 and recipient=to_recipients[1]));
grant insert(transport_protocol_version,to_recipients,cc_recipients) on public.workspace_emails to authenticated;

create or replace function workspace_email_private.normalize_recipients(p_addresses text[],p_required boolean)
returns text[] language plpgsql immutable security invoker set search_path='' as $$
declare v_address text; v_result text[]:='{}';
begin
 if p_addresses is null or cardinality(p_addresses)>10 or (p_required and cardinality(p_addresses)=0)
 or (cardinality(p_addresses)>0 and (array_ndims(p_addresses)<>1 or array_lower(p_addresses,1)<>1)) then raise exception 'INVALID_EMAIL_RECIPIENTS'; end if;
 foreach v_address in array p_addresses loop
  if v_address is null or v_address ~ '[[:cntrl:]]' then raise exception 'INVALID_EMAIL_RECIPIENTS'; end if;
  v_address:=lower(btrim(v_address));
  if length(v_address)>254 or length(split_part(v_address,'@',1))>64 or v_address !~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' then raise exception 'INVALID_EMAIL_RECIPIENTS'; end if;
  if v_address=any(v_result) then raise exception 'DUPLICATE_EMAIL_RECIPIENTS'; end if;
  v_result:=array_append(v_result,v_address);
 end loop;
 return v_result;
end $$;
-- Runs after the old activity/chat insert guards. Their v1 hash formulas stay
-- byte-for-byte unchanged; new hashes bind every To/CC role and array order.
create or replace function workspace_email_private.guard_recipients()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_to text[]; v_cc text[];
begin
 if tg_op='UPDATE' then
  if row(new.transport_protocol_version,new.to_recipients,new.cc_recipients) is distinct from row(old.transport_protocol_version,old.to_recipients,old.cc_recipients) then raise exception 'IMMUTABLE_EMAIL_PROPOSAL'; end if;
  return new;
 end if;
 if new.transport_protocol_version=1 then
  if new.to_recipients is not null or new.cc_recipients is not null then raise exception 'INVALID_EMAIL_RECIPIENTS'; end if;
  return new;
 end if;
 if new.transport_protocol_version<>2 then raise exception 'INVALID_EMAIL_PROTOCOL'; end if;
 v_to:=workspace_email_private.normalize_recipients(new.to_recipients,true);
 v_cc:=workspace_email_private.normalize_recipients(new.cc_recipients,false);
 if cardinality(v_to)+cardinality(v_cc)>10 or v_to && v_cc then raise exception 'DUPLICATE_OR_TOO_MANY_EMAIL_RECIPIENTS'; end if;
 if new.to_recipients is distinct from v_to or new.cc_recipients is distinct from v_cc or new.recipient is distinct from v_to[1] then raise exception 'INVALID_EMAIL_RECIPIENTS'; end if;
 new.payload_hash:=encode(sha256(convert_to(jsonb_build_object('protocol',2,'source',new.source_kind,'task',new.task_id,'author',new.author_id,
  'to',new.to_recipients,'cc',new.cc_recipients,'subject',new.subject,'body',new.body,'viaAI',new.via_ai,'snapshot',new.task_snapshot)::text,'UTF8')),'hex');
 return new;
end $$;
create trigger workspace_z_email_recipients_guard before insert or update on public.workspace_emails for each row execute function workspace_email_private.guard_recipients();

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
  if v_row.id is null or v_row.transport_protocol_version<>1 or v_row.source_kind<>'chat' or v_row.recipient is distinct from p_recipient or v_row.subject is distinct from p_subject or v_row.body is distinct from p_body then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 end if;
 return v_row;
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
  if v_row.id is null or v_row.transport_protocol_version<>1 or v_row.task_id is distinct from p_task or v_row.recipient is distinct from p_recipient or v_row.subject is distinct from p_subject
   or v_row.body is distinct from p_body or v_row.via_ai is distinct from p_via_ai then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 end if;
 return v_row;
end $$;

create or replace function workspace_email_private.prepare_chat_v2(p_to text[],p_cc text[],p_subject text,p_body text,p_idempotency_key text)
returns public.workspace_emails language plpgsql security definer set search_path='' as $$
declare v_user uuid:=public.workspace_current_profile_id(); v_row public.workspace_emails; v_to text[]; v_cc text[];
begin
 if v_user is null or not workspace_email_private.chat_permission_for(v_user) then raise exception 'EMAIL_PERMISSION_REQUIRED'; end if;
 if not public.second_brain_enabled() or not public.workspace_ai_can_propose() then raise exception 'AI_EMAIL_PERMISSION_REQUIRED'; end if;
 v_to:=workspace_email_private.normalize_recipients(p_to,true); v_cc:=workspace_email_private.normalize_recipients(p_cc,false);
 if cardinality(v_to)+cardinality(v_cc)>10 or v_to && v_cc then raise exception 'DUPLICATE_OR_TOO_MANY_EMAIL_RECIPIENTS'; end if;
 insert into public.workspace_emails(author_id,source_kind,task_id,recipient,to_recipients,cc_recipients,transport_protocol_version,subject,body,idempotency_key,via_ai)
 values(v_user,'chat',null,v_to[1],v_to,v_cc,2,p_subject,p_body,p_idempotency_key,true)
 on conflict(author_id,idempotency_key) do nothing returning * into v_row;
 if v_row.id is null then
  select * into v_row from public.workspace_emails where author_id=v_user and idempotency_key=p_idempotency_key;
  if v_row.id is null or v_row.source_kind<>'chat' or v_row.transport_protocol_version<>2 or v_row.to_recipients is distinct from v_to or v_row.cc_recipients is distinct from v_cc
    or v_row.subject is distinct from p_subject or v_row.body is distinct from p_body then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 end if;
 return v_row;
end $$;
create or replace function public.workspace_prepare_chat_email_v2(p_to text[],p_cc text[],p_subject text,p_body text,p_idempotency_key text)
returns public.workspace_emails language sql security invoker set search_path='' as $$select workspace_email_private.prepare_chat_v2(p_to,p_cc,p_subject,p_body,p_idempotency_key)$$;

create or replace function public.workspace_propose_activity_email_v2(p_task uuid,p_to text[],p_cc text[],p_subject text,p_body text,p_idempotency_key text,p_via_ai boolean default false)
returns public.workspace_emails language plpgsql security invoker set search_path='' as $$
declare v_row public.workspace_emails; v_to text[]; v_cc text[];
begin
 if not public.workspace_activity_email_can_write(p_task) then raise exception 'EMAIL_PERMISSION_REQUIRED'; end if;
 if p_via_ai and (not public.second_brain_enabled() or not public.workspace_ai_can_propose()
  or not (coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]'::jsonb) ? 'attivita')) then raise exception 'AI_EMAIL_PERMISSION_REQUIRED'; end if;
 v_to:=workspace_email_private.normalize_recipients(p_to,true); v_cc:=workspace_email_private.normalize_recipients(p_cc,false);
 if cardinality(v_to)+cardinality(v_cc)>10 or v_to && v_cc then raise exception 'DUPLICATE_OR_TOO_MANY_EMAIL_RECIPIENTS'; end if;
 insert into public.workspace_emails(task_id,recipient,to_recipients,cc_recipients,transport_protocol_version,subject,body,idempotency_key,via_ai)
 values(p_task,v_to[1],v_to,v_cc,2,p_subject,p_body,p_idempotency_key,p_via_ai)
 on conflict(author_id,idempotency_key) do nothing returning * into v_row;
 if v_row.id is null then
  select * into v_row from public.workspace_emails where author_id=public.workspace_current_profile_id() and idempotency_key=p_idempotency_key;
  if v_row.id is null or v_row.source_kind<>'activity' or v_row.transport_protocol_version<>2 or v_row.task_id is distinct from p_task
    or v_row.to_recipients is distinct from v_to or v_row.cc_recipients is distinct from v_cc or v_row.subject is distinct from p_subject
    or v_row.body is distinct from p_body or v_row.via_ai is distinct from p_via_ai then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 end if;
 return v_row;
end $$;

-- A v2 delegation is a separate immutable, human-approved policy. Existing v1
-- grants are never upgraded or revoked implicitly.
alter table public.workspace_email_delegations drop constraint workspace_email_delegations_policy_version_check;
alter table public.workspace_email_delegations add constraint workspace_email_delegations_policy_version_check check(policy_version in ('chat-email-v1','chat-email-v2'));
alter table public.workspace_emails drop constraint workspace_email_delegation_snapshot;
alter table public.workspace_emails add constraint workspace_email_delegation_snapshot check(
 (delegation_id is null and delegation_policy_hash is null and delegation_policy_version is null)
 or (source_kind='chat' and delegation_id is not null and delegation_policy_hash ~ '^[a-f0-9]{64}$' and delegation_policy_version in ('chat-email-v1','chat-email-v2')));
drop index public.workspace_email_delegation_current;
create unique index workspace_email_delegation_current on public.workspace_email_delegations(author_id,policy_version) where status in ('proposed','active');
create or replace function workspace_email_private.chat_policy_v2()
returns jsonb language sql immutable security invoker set search_path='' as $$
 select '{"version":"chat-email-v2","scope":"Solo singole email testuali richieste esplicitamente in chat dal titolare, fino a 10 destinatari specifici in To e CC indicati nella richiesta. Nessun BCC, allegato, invio ricorrente o massivo.","explicit_user_request_required":true,"specific_recipient_required":true,"single_recipient":false,"to_and_cc":true,"max_recipients":10,"bcc":false,"plain_text_only":true,"attachments":false,"recurring":false,"bulk":false}'::jsonb
$$;
create or replace function workspace_email_private.policy_for(p_version text)
returns jsonb language sql immutable security invoker set search_path='' as $$
 select case p_version when 'chat-email-v1' then workspace_email_private.chat_policy() when 'chat-email-v2' then workspace_email_private.chat_policy_v2() else null end
$$;

create or replace function workspace_email_private.guard_delegation()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not pg_has_role(current_user,'service_role','USAGE') then raise exception 'HUMAN_BACKEND_REQUIRED'; end if;
 if tg_op='INSERT' then
  if new.status<>'proposed' or new.approved_by is not null or new.approved_at is not null or new.revoked_by is not null or new.revoked_at is not null or new.approval_method is not null then raise exception 'DELEGATION_MUST_BE_PROPOSED'; end if;
  new.policy:=workspace_email_private.policy_for(new.policy_version);
  if new.policy is null then raise exception 'INVALID_EMAIL_POLICY'; end if;
  new.created_at:=now();
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

create or replace function workspace_email_private.propose_delegation_for(p_version text)
returns public.workspace_email_delegations language plpgsql security definer set search_path='' as $$
declare v_user uuid:=public.workspace_current_profile_id(); v_row public.workspace_email_delegations;
begin
 if v_user is null or not workspace_email_private.chat_permission_for(v_user) then raise exception 'EMAIL_PERMISSION_REQUIRED'; end if;
 if not public.second_brain_enabled() or not public.workspace_ai_can_propose() then raise exception 'AI_EMAIL_PERMISSION_REQUIRED'; end if;
 if workspace_email_private.policy_for(p_version) is null then raise exception 'INVALID_EMAIL_POLICY'; end if;
 perform pg_advisory_xact_lock(hashtextextended('email-delegation:'||v_user::text,0));
 select * into v_row from public.workspace_email_delegations where author_id=v_user and policy_version=p_version and status in ('proposed','active');
 if v_row.id is not null then return v_row; end if;
 insert into public.workspace_email_delegations(author_id,policy_version) values(v_user,p_version) returning * into v_row;
 return v_row;
end $$;
create or replace function workspace_email_private.propose_delegation()
returns public.workspace_email_delegations language sql security definer set search_path='' as $$select workspace_email_private.propose_delegation_for('chat-email-v1')$$;
create or replace function public.workspace_propose_email_delegation_v2()
returns public.workspace_email_delegations language sql security invoker set search_path='' as $$select workspace_email_private.propose_delegation_for('chat-email-v2')$$;

create or replace function workspace_email_private.decide_delegation(p_actor uuid,p_id uuid,p_confirm boolean,p_expected_hash text)
returns public.workspace_email_delegations language plpgsql security definer set search_path='' as $$
declare v_row public.workspace_email_delegations;
begin
 if p_actor is null or p_confirm is null then raise exception 'EXPLICIT_EMAIL_DECISION_REQUIRED'; end if;
 select * into v_row from public.workspace_email_delegations where id=p_id and author_id=p_actor for update;
 if v_row.id is null then raise exception 'EMAIL_NOT_ACCESSIBLE'; end if;
 if p_expected_hash is null or v_row.policy_hash is distinct from p_expected_hash or workspace_email_private.policy_for(v_row.policy_version) is null or v_row.policy is distinct from workspace_email_private.policy_for(v_row.policy_version) then raise exception 'EMAIL_DELEGATION_CHANGED'; end if;
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

create or replace function workspace_email_private.delegation_covers(p_delegation public.workspace_email_delegations,p_email public.workspace_emails)
returns boolean language sql immutable security invoker set search_path='' as $$
 select p_delegation.author_id=p_email.author_id and p_delegation.status='active'
 and p_delegation.policy=workspace_email_private.policy_for(p_delegation.policy_version)
 and (p_delegation.policy_version='chat-email-v2' or (p_delegation.policy_version='chat-email-v1' and
  (p_email.transport_protocol_version=1 or (cardinality(p_email.to_recipients)=1 and cardinality(p_email.cc_recipients)=0))))
$$;

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
 select * into v_delegation from public.workspace_email_delegations where author_id=v_user and workspace_email_private.delegation_covers(workspace_email_delegations,v_row) order by policy_version desc limit 1 for share;
 if v_delegation.id is null then raise exception 'EMAIL_DELEGATION_REQUIRED'; end if;
 update public.workspace_emails set status='queued',confirmed_by=v_user,confirmed_at=now(),delegation_id=v_delegation.id,
 delegation_policy_hash=v_delegation.policy_hash,delegation_policy_version=v_delegation.policy_version where id=v_row.id returning * into v_row;
 return v_row;
end $$;

create or replace function workspace_email_private.chat_capability()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=public.workspace_current_profile_id(); v_permission boolean; v_prepare boolean; v_confirm boolean; v_delegation public.workspace_email_delegations; v_delegations jsonb:='[]'; v_multi boolean:=false; v_single boolean:=false;
begin
 v_permission:=v_user is not null and workspace_email_private.chat_permission_for(v_user);
 v_prepare:=v_permission and public.second_brain_enabled() and public.workspace_ai_can_propose();
 v_confirm:=v_permission and public.second_brain_enabled() and public.workspace_ai_can_confirm();
 if v_permission then
  select * into v_delegation from public.workspace_email_delegations where author_id=v_user and status in ('proposed','active') and policy=workspace_email_private.policy_for(policy_version) order by policy_version desc limit 1;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.policy_version),'[]'),coalesce(bool_or(d.status='active'),false),coalesce(bool_or(d.status='active' and d.policy_version='chat-email-v2'),false)
   into v_delegations,v_single,v_multi from public.workspace_email_delegations d where author_id=v_user and status in ('proposed','active') and policy=workspace_email_private.policy_for(policy_version);
 end if;
 return jsonb_build_object('enabled',v_permission,'canPrepare',v_prepare,'canConfirm',v_confirm,'canSend',v_confirm and v_single,'canSendMultiple',v_confirm and v_multi,
  'requiresDelegation',not v_single,'requiresMultipleRecipientDelegation',not v_multi,'delegations',v_delegations,
  'delegation',case when v_delegation.id is null then null else to_jsonb(v_delegation) end,'policyVersion',coalesce(v_delegation.policy_version,'chat-email-v2'),
  'scope',workspace_email_private.policy_for(coalesce(v_delegation.policy_version,'chat-email-v2')),'maxRecipients',10,'supportsToAndCc',true);
end $$;

-- Re-evaluate activity visibility, task snapshot and current actor permissions
-- when claiming. Service-role privileges must not substitute for the actor.
create or replace function workspace_email_private.activity_authorized(p_email public.workspace_emails)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_auth uuid; v_sub text:=current_setting('request.jwt.claim.sub',true); v_claims text:=current_setting('request.jwt.claims',true); v_allowed boolean; v_snapshot jsonb;
begin
 select auth_user_id into v_auth from public.utenti where id=p_email.author_id and attivo is not false;
 if v_auth is null then return false; end if;
 perform set_config('request.jwt.claim.sub',v_auth::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_auth,'role','authenticated')::text,true);
 v_allowed:=public.workspace_activity_email_can_write(p_email.task_id);
 if p_email.via_ai then v_allowed:=v_allowed and public.second_brain_enabled() and public.workspace_ai_can_confirm()
  and (coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]'::jsonb) ? 'attivita'); end if;
 select to_jsonb(t) into v_snapshot from public.v4_fasi_progetto t where id=p_email.task_id;
 v_allowed:=v_allowed and v_snapshot is not null and v_snapshot=p_email.task_snapshot;
 perform set_config('request.jwt.claim.sub',coalesce(v_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
 return coalesce(v_allowed,false);
end $$;

create or replace function public.workspace_claim_email_v2(p_worker text,p_transport_protocol_version integer)
returns setof jsonb language plpgsql security invoker set search_path='' as $$
declare v_row public.workspace_emails; v_lock uuid; v_delegation public.workspace_email_delegations; v_valid boolean; i integer;
begin
 if p_worker is null or length(btrim(p_worker)) not between 1 and 128 then raise exception 'INVALID_WORKER'; end if;
 if p_transport_protocol_version is null or p_transport_protocol_version not in (1,2) then raise exception 'INVALID_EMAIL_PROTOCOL'; end if;
 for i in 1..20 loop
  -- The filter precedes lock/transition: an old worker can never receive or
  -- truncate a v2 email, even if it polls before an upgraded worker does.
  select * into v_row from public.workspace_emails where status='queued' and transport_protocol_version<=p_transport_protocol_version order by created_at,id for update skip locked limit 1;
  if v_row.id is null then return; end if;
  if v_row.source_kind='chat' then
   v_valid:=workspace_email_private.chat_permission_for(v_row.author_id) and workspace_email_private.actor_ai_confirm(v_row.author_id);
   if v_row.delegation_id is not null then
    select * into v_delegation from public.workspace_email_delegations where id=v_row.delegation_id for share;
    v_valid:=v_valid and v_delegation.id is not null and workspace_email_private.delegation_covers(v_delegation,v_row)
      and v_delegation.policy_hash=v_row.delegation_policy_hash and v_delegation.policy_version=v_row.delegation_policy_version;
   end if;
  else
   v_valid:=workspace_email_private.activity_authorized(v_row);
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
create or replace function public.workspace_claim_email(p_worker text)
returns setof jsonb language sql security invoker set search_path='' as $$select * from public.workspace_claim_email_v2(p_worker,1)$$;

revoke all on function workspace_email_private.normalize_recipients(text[],boolean),workspace_email_private.guard_recipients(),workspace_email_private.prepare_chat_v2(text[],text[],text,text,text),workspace_email_private.chat_policy_v2(),workspace_email_private.policy_for(text),workspace_email_private.propose_delegation_for(text),workspace_email_private.delegation_covers(public.workspace_email_delegations,public.workspace_emails),workspace_email_private.activity_authorized(public.workspace_emails) from public,anon,authenticated;
grant execute on function workspace_email_private.normalize_recipients(text[],boolean),workspace_email_private.prepare_chat_v2(text[],text[],text,text,text),workspace_email_private.propose_delegation_for(text) to authenticated;
grant execute on function workspace_email_private.normalize_recipients(text[],boolean),workspace_email_private.chat_policy_v2(),workspace_email_private.policy_for(text),workspace_email_private.delegation_covers(public.workspace_email_delegations,public.workspace_emails),workspace_email_private.activity_authorized(public.workspace_emails) to service_role;
revoke all on function public.workspace_prepare_chat_email_v2(text[],text[],text,text,text),public.workspace_propose_activity_email_v2(uuid,text[],text[],text,text,text,boolean),public.workspace_propose_email_delegation_v2(),public.workspace_claim_email_v2(text,integer) from public,anon,authenticated;
grant execute on function public.workspace_prepare_chat_email_v2(text[],text[],text,text,text),public.workspace_propose_activity_email_v2(uuid,text[],text[],text,text,text,boolean),public.workspace_propose_email_delegation_v2() to authenticated;
grant execute on function public.workspace_claim_email_v2(text,integer) to service_role;
notify pgrst,'reload schema';
commit;

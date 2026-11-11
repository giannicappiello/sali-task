begin;
-- Raise only ordinary Workspace text-email capacity. Never rewrite existing
-- recipient payloads, hashes, receipts or human-approved v1/v2 delegations.
-- Protocol 3 isolates 11..30 recipients from workers still limited to 10.
alter table public.workspace_emails drop constraint workspace_email_recipient_protocol;
alter table public.workspace_emails add constraint workspace_email_recipient_protocol check(
 (transport_protocol_version=1 and to_recipients is null and cc_recipients is null)
 or (transport_protocol_version in (2,3) and to_recipients is not null and cc_recipients is not null
 and cardinality(to_recipients)>=1 and recipient=to_recipients[1]
 and ((transport_protocol_version=2 and cardinality(to_recipients)+cardinality(cc_recipients)<=10)
 or (transport_protocol_version=3 and cardinality(to_recipients)+cardinality(cc_recipients) between 11 and 30))));


create or replace function workspace_email_private.normalize_recipients(p_addresses text[],p_required boolean)
returns text[] language plpgsql immutable security invoker set search_path='' as $$
declare v_address text; v_result text[]:='{}';
begin
 if p_addresses is null or cardinality(p_addresses)>30 or (p_required and cardinality(p_addresses)=0)
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
 if new.transport_protocol_version not in (2,3) then raise exception 'INVALID_EMAIL_PROTOCOL'; end if;
 v_to:=workspace_email_private.normalize_recipients(new.to_recipients,true);
 v_cc:=workspace_email_private.normalize_recipients(new.cc_recipients,false);
 if cardinality(v_to)+cardinality(v_cc)>30 or v_to && v_cc then raise exception 'DUPLICATE_OR_TOO_MANY_EMAIL_RECIPIENTS'; end if;
 if new.to_recipients is distinct from v_to or new.cc_recipients is distinct from v_cc or new.recipient is distinct from v_to[1] then raise exception 'INVALID_EMAIL_RECIPIENTS'; end if;
 new.payload_hash:=encode(sha256(convert_to(jsonb_build_object('protocol',new.transport_protocol_version,'source',new.source_kind,'task',new.task_id,'author',new.author_id,
  'to',new.to_recipients,'cc',new.cc_recipients,'subject',new.subject,'body',new.body,'viaAI',new.via_ai,'snapshot',new.task_snapshot)::text,'UTF8')),'hex');
 return new;
end $$;

create or replace function workspace_email_private.prepare_chat_v2(p_to text[],p_cc text[],p_subject text,p_body text,p_idempotency_key text)
returns public.workspace_emails language plpgsql security definer set search_path='' as $$
declare v_user uuid:=public.workspace_current_profile_id(); v_row public.workspace_emails; v_to text[]; v_cc text[]; v_protocol smallint;
begin
 if v_user is null or not workspace_email_private.chat_permission_for(v_user) then raise exception 'EMAIL_PERMISSION_REQUIRED'; end if;
 if not public.second_brain_enabled() or not public.workspace_ai_can_propose() then raise exception 'AI_EMAIL_PERMISSION_REQUIRED'; end if;
 v_to:=workspace_email_private.normalize_recipients(p_to,true); v_cc:=workspace_email_private.normalize_recipients(p_cc,false);
 if cardinality(v_to)+cardinality(v_cc)>30 or v_to && v_cc then raise exception 'DUPLICATE_OR_TOO_MANY_EMAIL_RECIPIENTS'; end if;
 v_protocol:=case when cardinality(v_to)+cardinality(v_cc)>10 then 3 else 2 end;
 insert into public.workspace_emails(author_id,source_kind,task_id,recipient,to_recipients,cc_recipients,transport_protocol_version,subject,body,idempotency_key,via_ai)
 values(v_user,'chat',null,v_to[1],v_to,v_cc,v_protocol,p_subject,p_body,p_idempotency_key,true)
 on conflict(author_id,idempotency_key) do nothing returning * into v_row;
 if v_row.id is null then
  select * into v_row from public.workspace_emails where author_id=v_user and idempotency_key=p_idempotency_key;
  if v_row.id is null or v_row.source_kind<>'chat' or v_row.transport_protocol_version<>v_protocol or v_row.to_recipients is distinct from v_to or v_row.cc_recipients is distinct from v_cc
    or v_row.subject is distinct from p_subject or v_row.body is distinct from p_body then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 end if;
 return v_row;
end $$;

create or replace function public.workspace_propose_activity_email_v2(p_task uuid,p_to text[],p_cc text[],p_subject text,p_body text,p_idempotency_key text,p_via_ai boolean default false)
returns public.workspace_emails language plpgsql security invoker set search_path='' as $$
declare v_row public.workspace_emails; v_to text[]; v_cc text[]; v_protocol smallint;
begin
 if not public.workspace_activity_email_can_write(p_task) then raise exception 'EMAIL_PERMISSION_REQUIRED'; end if;
 if p_via_ai and (not public.second_brain_enabled() or not public.workspace_ai_can_propose()
  or not (coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]'::jsonb) ? 'attivita')) then raise exception 'AI_EMAIL_PERMISSION_REQUIRED'; end if;
 v_to:=workspace_email_private.normalize_recipients(p_to,true); v_cc:=workspace_email_private.normalize_recipients(p_cc,false);
 if cardinality(v_to)+cardinality(v_cc)>30 or v_to && v_cc then raise exception 'DUPLICATE_OR_TOO_MANY_EMAIL_RECIPIENTS'; end if;
 v_protocol:=case when cardinality(v_to)+cardinality(v_cc)>10 then 3 else 2 end;
 insert into public.workspace_emails(task_id,recipient,to_recipients,cc_recipients,transport_protocol_version,subject,body,idempotency_key,via_ai)
 values(p_task,v_to[1],v_to,v_cc,v_protocol,p_subject,p_body,p_idempotency_key,p_via_ai)
 on conflict(author_id,idempotency_key) do nothing returning * into v_row;
 if v_row.id is null then
  select * into v_row from public.workspace_emails where author_id=public.workspace_current_profile_id() and idempotency_key=p_idempotency_key;
  if v_row.id is null or v_row.source_kind<>'activity' or v_row.transport_protocol_version<>v_protocol or v_row.task_id is distinct from p_task
    or v_row.to_recipients is distinct from v_to or v_row.cc_recipients is distinct from v_cc or v_row.subject is distinct from p_subject
    or v_row.body is distinct from p_body or v_row.via_ai is distinct from p_via_ai then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 end if;
 return v_row;
end $$;

-- New consent is explicit and independent. v1 and v2 policies remain unchanged.
alter table public.workspace_email_delegations drop constraint workspace_email_delegations_policy_version_check;
alter table public.workspace_email_delegations add constraint workspace_email_delegations_policy_version_check check(policy_version in ('chat-email-v1','chat-email-v2','chat-email-v3'));
alter table public.workspace_emails drop constraint workspace_email_delegation_snapshot;
alter table public.workspace_emails add constraint workspace_email_delegation_snapshot check(
 (delegation_id is null and delegation_policy_hash is null and delegation_policy_version is null)
 or (source_kind='chat' and delegation_id is not null and delegation_policy_hash ~ '^[a-f0-9]{64}$' and delegation_policy_version in ('chat-email-v1','chat-email-v2','chat-email-v3')));

create or replace function workspace_email_private.chat_policy_v3()
returns jsonb language sql immutable security invoker set search_path='' as $$
 select '{"version":"chat-email-v3","scope":"Solo singole email testuali richieste esplicitamente in chat dal titolare, fino a 30 destinatari specifici in To e CC indicati nella richiesta. Nessun BCC, allegato, invio ricorrente o massivo.","explicit_user_request_required":true,"specific_recipient_required":true,"single_recipient":false,"to_and_cc":true,"max_recipients":30,"bcc":false,"plain_text_only":true,"attachments":false,"recurring":false,"bulk":false}'::jsonb
$$;

create or replace function workspace_email_private.policy_for(p_version text)
returns jsonb language sql immutable security invoker set search_path='' as $$
 select case p_version when 'chat-email-v1' then workspace_email_private.chat_policy() when 'chat-email-v2' then workspace_email_private.chat_policy_v2() when 'chat-email-v3' then workspace_email_private.chat_policy_v3() else null end
$$;

create or replace function public.workspace_propose_email_delegation_v3()
returns public.workspace_email_delegations language sql security invoker set search_path='' as $$select workspace_email_private.propose_delegation_for('chat-email-v3')$$;

create or replace function workspace_email_private.delegation_covers(p_delegation public.workspace_email_delegations,p_email public.workspace_emails)
returns boolean language sql immutable security invoker set search_path='' as $$
 select p_delegation.author_id=p_email.author_id and p_delegation.status='active'
 and p_email.source_kind='chat'
 and p_delegation.policy=workspace_email_private.policy_for(p_delegation.policy_version)
 and ((p_delegation.policy_version='chat-email-v3' and
   (p_email.transport_protocol_version=1 or cardinality(p_email.to_recipients)+cardinality(p_email.cc_recipients) between 1 and 30))
 or (p_delegation.policy_version='chat-email-v2' and
   (p_email.transport_protocol_version=1 or cardinality(p_email.to_recipients)+cardinality(p_email.cc_recipients) between 1 and 10))
 or (p_delegation.policy_version='chat-email-v1' and
   (p_email.transport_protocol_version=1 or (cardinality(p_email.to_recipients)=1 and cardinality(p_email.cc_recipients)=0))))
$$;

create or replace function workspace_email_private.chat_capability()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=public.workspace_current_profile_id(); v_permission boolean; v_prepare boolean; v_confirm boolean; v_delegation public.workspace_email_delegations; v_delegations jsonb:='[]'; v_multi boolean:=false; v_thirty boolean:=false; v_authorized_max integer:=0; v_single boolean:=false;
begin
 v_permission:=v_user is not null and workspace_email_private.chat_permission_for(v_user);
 v_prepare:=v_permission and public.second_brain_enabled() and public.workspace_ai_can_propose();
 v_confirm:=v_permission and public.second_brain_enabled() and public.workspace_ai_can_confirm();
 if v_permission then
  select * into v_delegation from public.workspace_email_delegations where author_id=v_user and status in ('proposed','active') and policy=workspace_email_private.policy_for(policy_version) order by policy_version desc limit 1;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.policy_version),'[]'),coalesce(bool_or(d.status='active'),false),coalesce(bool_or(d.status='active' and d.policy_version in ('chat-email-v2','chat-email-v3')),false),
   coalesce(bool_or(d.status='active' and d.policy_version='chat-email-v3'),false),
   coalesce(max(case when d.status='active' then case d.policy_version when 'chat-email-v3' then 30 when 'chat-email-v2' then 10 else 1 end else 0 end),0)
   into v_delegations,v_single,v_multi,v_thirty,v_authorized_max from public.workspace_email_delegations d where author_id=v_user and status in ('proposed','active') and policy=workspace_email_private.policy_for(policy_version);
 end if;
 return jsonb_build_object('enabled',v_permission,'canPrepare',v_prepare,'canConfirm',v_confirm,'canSend',v_confirm and v_single,'canSendMultiple',v_confirm and v_multi,'canSendThirty',v_confirm and v_thirty,
  'authorizedMaxRecipients',case when v_confirm then v_authorized_max else 0 end,'requiresThirtyRecipientDelegation',not v_thirty,
  'requiresDelegation',not v_single,'requiresMultipleRecipientDelegation',not v_multi,'delegations',v_delegations,
  'delegation',case when v_delegation.id is null then null else to_jsonb(v_delegation) end,'policyVersion',coalesce(v_delegation.policy_version,'chat-email-v3'),
  'scope',workspace_email_private.policy_for(coalesce(v_delegation.policy_version,'chat-email-v3')),'maxRecipients',30,'supportsToAndCc',true);
end $$;

create or replace function public.workspace_claim_email_v2(p_worker text,p_transport_protocol_version integer)
returns setof jsonb language plpgsql security invoker set search_path='' as $$
declare v_row public.workspace_emails; v_lock uuid; v_delegation public.workspace_email_delegations; v_valid boolean; i integer;
begin
 if p_worker is null or length(btrim(p_worker)) not between 1 and 128 then raise exception 'INVALID_WORKER'; end if;
 if p_transport_protocol_version is null or p_transport_protocol_version not in (1,2,3) then raise exception 'INVALID_EMAIL_PROTOCOL'; end if;
 for i in 1..20 loop
  -- The filter precedes lock/transition: an old worker can never receive or
  -- truncate a newer email, even if it polls before an upgraded worker does.
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

revoke all on function workspace_email_private.chat_policy_v3() from public,anon,authenticated;
grant execute on function workspace_email_private.chat_policy_v3() to service_role;
revoke all on function public.workspace_propose_email_delegation_v3() from public,anon,authenticated;
grant execute on function public.workspace_propose_email_delegation_v3() to authenticated;
notify pgrst,'reload schema';
commit;

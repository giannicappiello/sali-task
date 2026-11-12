create table public.commercial_report_email_parts (
 email_id uuid not null references public.commercial_report_emails(id),
 part integer not null check(part>=0), total integer not null check(total between 1 and 40 and part<total),
 plan_hash text not null check(plan_hash ~ '^[a-f0-9]{64}$'), artifact_keys jsonb not null,
 status text not null check(status in ('pending','uncertain','sent','failed')),
 lock_token uuid not null, provider_message_id text, sent_at timestamptz, last_error text,
 primary key(email_id,part)
);
alter table public.commercial_report_email_parts enable row level security;
revoke all on public.commercial_report_email_parts from public,anon,authenticated;
grant all on public.commercial_report_email_parts to service_role;

create function public.commercial_report_claim_part(p_email uuid,p_worker text,p_lock uuid,p_part integer,p_total integer,p_hash text,p_keys jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare e public.commercial_report_emails; current_part public.commercial_report_email_parts;
begin
 select * into e from public.commercial_report_emails where id=p_email for update;
 if not found or e.status<>'uncertain' or e.worker_id is distinct from p_worker or e.lock_token is distinct from p_lock then raise exception 'Tentativo non accessibile'; end if;
 if not exists(select 1 from public.commercial_report_batches b join public.commercial_report_settings s on s.singleton
  join public.utenti u on u.id=s.owner_id join public.ruoli r on r.id=u.ruolo_id
  where b.id=e.batch_id and b.status='queued' and s.enabled and s.owner_id=b.owner_id and s.policy_hash=b.policy_hash
  and u.attivo and r.amministratore_workspace) then raise exception 'Piano non attivo'; end if;
 if p_total is null or p_part is null or p_hash is null or p_total not between 1 and 40 or p_part not between 0 and p_total-1
  or p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_keys) is distinct from 'array' or jsonb_array_length(p_keys)=0 or not p_keys<@e.artifact_keys then raise exception 'Parte fuori dal piano'; end if;
 if jsonb_array_length(p_keys)<>(select count(distinct k) from jsonb_array_elements(p_keys) k) then raise exception 'PDF duplicato nella parte'; end if;
 if exists(select 1 from public.commercial_report_email_parts where email_id=e.id and (plan_hash<>p_hash or total<>p_total)) then raise exception 'Piano parti variato'; end if;
 select * into current_part from public.commercial_report_email_parts where email_id=e.id and part=p_part;
 if found then
  if current_part.artifact_keys<>p_keys then raise exception 'Allegati parte variati'; end if;
  if current_part.status='sent' then return 'already_sent'; end if;
  if current_part.status<>'pending' then return 'requires_review'; end if;
 else
  if exists(select 1 from public.commercial_report_email_parts p where p.email_id=e.id and exists(select 1 from jsonb_array_elements(p_keys) k where p.artifact_keys @> jsonb_build_array(k))) then raise exception 'PDF duplicato fra parti'; end if;
  insert into public.commercial_report_email_parts(email_id,part,total,plan_hash,artifact_keys,status,lock_token) values(e.id,p_part,p_total,p_hash,p_keys,'pending',p_lock);
 end if;
 update public.commercial_report_email_parts set status='uncertain',lock_token=p_lock,last_error=null where email_id=e.id and part=p_part;
 return 'claimed';
end;
$$;

create function public.commercial_report_finish_part(p_email uuid,p_worker text,p_lock uuid,p_part integer,p_hash text,p_status text,p_receipt text,p_error text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare e public.commercial_report_emails; b_id uuid; expected integer;
begin
 select batch_id into b_id from public.commercial_report_emails where id=p_email;
 perform 1 from public.commercial_report_batches where id=b_id for update;
 select * into e from public.commercial_report_emails where id=p_email for update;
 if not found or e.worker_id is distinct from p_worker or e.lock_token is distinct from p_lock or e.status not in ('uncertain','sent') then raise exception 'Tentativo non accessibile'; end if;
 if not exists(select 1 from public.commercial_report_batches b join public.commercial_report_settings s on s.singleton
  join public.utenti u on u.id=s.owner_id join public.ruoli r on r.id=u.ruolo_id
  where b.id=e.batch_id and s.enabled and s.owner_id=b.owner_id and s.policy_hash=b.policy_hash and u.attivo and r.amministratore_workspace) then raise exception 'Piano non attivo'; end if;
 if p_status is null or p_status not in ('sent','failed') or (p_status='sent' and length(trim(coalesce(p_receipt,'')))=0) then raise exception 'Esito parte non valido'; end if;
 select total into expected from public.commercial_report_email_parts where email_id=e.id and part=p_part and plan_hash=p_hash and lock_token=p_lock;
 if not found then raise exception 'Parte non accessibile'; end if;
 update public.commercial_report_email_parts set status=p_status,provider_message_id=left(p_receipt,200),sent_at=case when p_status='sent' then now() end,last_error=left(p_error,1000)
  where email_id=e.id and part=p_part and plan_hash=p_hash and lock_token=p_lock and status='uncertain';
 if (select count(*) from public.commercial_report_email_parts where email_id=e.id and plan_hash=p_hash and status='sent')=expected
  and (select sum(jsonb_array_length(artifact_keys)) from public.commercial_report_email_parts where email_id=e.id and plan_hash=p_hash)=jsonb_array_length(e.artifact_keys) then
  update public.commercial_report_emails set status='sent',provider_message_id='multipart:'||p_hash,sent_at=now(),last_error=null where id=e.id and status='uncertain';
  perform public.commercial_report_finish_batch(e.batch_id);
  return true;
 end if;
 return false;
end;
$$;
revoke all on function public.commercial_report_claim_part(uuid,text,uuid,integer,integer,text,jsonb),public.commercial_report_finish_part(uuid,text,uuid,integer,text,text,text,text) from public,anon,authenticated;
grant execute on function public.commercial_report_claim_part(uuid,text,uuid,integer,integer,text,jsonb),public.commercial_report_finish_part(uuid,text,uuid,integer,text,text,text,text) to service_role;

-- An explicit owner resend keeps accepted parts and archives every previous
-- part state together with the parent attempt before resetting unconfirmed parts.
create or replace function public.commercial_report_authorize_resend(
 p_actor uuid,p_batch uuid,p_email uuid,p_claimed_at timestamptz,p_request uuid,p_reason text,p_accept_duplicate boolean
) returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.commercial_report_batches; e public.commercial_report_emails;
begin
 select * into b from public.commercial_report_batches where id=p_batch for update;
 if not found or b.owner_id<>p_actor or b.status<>'queued' then raise exception 'Lotto non accessibile'; end if;
 if not exists(select 1 from public.commercial_report_settings s join public.utenti u on u.id=s.owner_id join public.ruoli r on r.id=u.ruolo_id
  where s.singleton and s.enabled and s.owner_id=p_actor and s.policy_hash=b.policy_hash and u.attivo and r.amministratore_workspace) then raise exception 'Delega non attiva'; end if;
 if p_accept_duplicate is distinct from true or length(trim(coalesce(p_reason,''))) not between 10 and 1000 or p_request is null then raise exception 'Conferma esplicita del reinvio mancante'; end if;
 if exists(select 1 from public.commercial_report_resend_history where request_id=p_request) then
  if exists(select 1 from public.commercial_report_resend_history where request_id=p_request and email_id=p_email and actor_id=p_actor) then return false; end if;
  raise exception 'Richiesta già utilizzata';
 end if;
 select * into e from public.commercial_report_emails where id=p_email and batch_id=p_batch for update;
 if not found or e.status<>'uncertain' or e.sent_at is not null or e.claimed_at is distinct from p_claimed_at or e.claimed_at is null or e.claimed_at>now()-interval '10 minutes' then raise exception 'Esito variato o tentativo ancora in corso: aggiornare lo stato'; end if;
 insert into public.commercial_report_resend_history(email_id,actor_id,request_id,reason,previous_attempt)
  values(e.id,p_actor,p_request,trim(p_reason),to_jsonb(e)||jsonb_build_object('parts',coalesce((select jsonb_agg(to_jsonb(p)) from public.commercial_report_email_parts p where p.email_id=e.id),'[]'::jsonb)));
 update public.commercial_report_email_parts set status='pending',last_error=null where email_id=e.id and status<>'sent';
 update public.commercial_report_emails set status='pending',worker_id=null,lock_token=null,claimed_at=null,provider_message_id=null,last_error=null where id=e.id;
 return true;
end;
$$;

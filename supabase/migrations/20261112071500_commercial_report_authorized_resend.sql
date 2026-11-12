-- An uncertain envelope is never retried automatically. The owner may explicitly
-- authorize one new attempt, acknowledging possible duplicates, after inspection.
alter table public.commercial_report_emails add column last_error text;
create table public.commercial_report_resend_history (
 id uuid primary key default gen_random_uuid(),
 email_id uuid not null references public.commercial_report_emails(id),
 actor_id uuid not null references public.utenti(id),
 request_id uuid not null unique,
 reason text not null,
 previous_attempt jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.commercial_report_resend_history enable row level security;
revoke all on public.commercial_report_resend_history from public,anon,authenticated;
grant all on public.commercial_report_resend_history to service_role;
create function public.commercial_report_authorize_resend(
 p_actor uuid,p_batch uuid,p_email uuid,p_claimed_at timestamptz,p_request uuid,p_reason text,p_accept_duplicate boolean
) returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.commercial_report_batches; e public.commercial_report_emails;
begin
 select * into b from public.commercial_report_batches where id=p_batch for update;
 if not found or b.owner_id<>p_actor or b.status<>'queued' then raise exception 'Lotto non accessibile'; end if;
 if not exists(select 1 from public.commercial_report_settings s
  join public.utenti u on u.id=s.owner_id join public.ruoli r on r.id=u.ruolo_id
  where s.singleton and s.enabled and s.owner_id=p_actor and s.policy_hash=b.policy_hash
   and u.attivo is true and r.amministratore_workspace is true) then raise exception 'Delega non attiva'; end if;
 if p_accept_duplicate is distinct from true or length(trim(coalesce(p_reason,''))) not between 10 and 1000 or p_request is null then raise exception 'Conferma esplicita del reinvio mancante'; end if;
 if exists(select 1 from public.commercial_report_resend_history where request_id=p_request) then
  if exists(select 1 from public.commercial_report_resend_history where request_id=p_request and email_id=p_email and actor_id=p_actor) then return false; end if;
  raise exception 'Richiesta già utilizzata';
 end if;
 select * into e from public.commercial_report_emails where id=p_email and batch_id=p_batch for update;
 if not found or e.status<>'uncertain' or e.sent_at is not null or e.claimed_at is distinct from p_claimed_at
  or e.claimed_at is null or e.claimed_at>now()-interval '10 minutes' then raise exception 'Esito variato o tentativo ancora in corso: aggiornare lo stato'; end if;
 insert into public.commercial_report_resend_history(email_id,actor_id,request_id,reason,previous_attempt)
  values(e.id,p_actor,p_request,trim(p_reason),to_jsonb(e));
 update public.commercial_report_emails set status='pending',worker_id=null,lock_token=null,claimed_at=null,provider_message_id=null,last_error=null where id=e.id;
 return true;
end;
$$;
revoke all on function public.commercial_report_authorize_resend(uuid,uuid,uuid,timestamptz,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.commercial_report_authorize_resend(uuid,uuid,uuid,timestamptz,uuid,text,boolean) to service_role;

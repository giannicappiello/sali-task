-- Keep the in-flight batch on its original start date. Future plans default to day 2.
alter table public.commercial_report_settings
  add column delivery_day smallint not null default 10 check (delivery_day in (2,10)),
  add column next_delivery_day smallint check (next_delivery_day in (2,10)),
  add column schedule_transition_batch_id uuid references public.commercial_report_batches(id);
alter table public.commercial_report_batches
  add column delivery_day smallint not null default 10 check (delivery_day in (2,10));

update public.commercial_report_settings s
set next_delivery_day=2, schedule_transition_batch_id=(
  select b.id from public.commercial_report_batches b
  where b.owner_id=s.owner_id and b.status<>'sent'
  order by b.period,b.created_at limit 1
);
update public.commercial_report_settings
set delivery_day=2,next_delivery_day=null
where schedule_transition_batch_id is null;
alter table public.commercial_report_settings alter column delivery_day set default 2;
alter table public.commercial_report_batches alter column delivery_day set default 2;

-- No upper time bound. Only never-claimed pending messages may be claimed.
create or replace function public.commercial_report_claim_email(p_worker text)
returns setof public.commercial_report_emails language sql security invoker
set search_path='' as $$
  with candidate as (
    select e.id from public.commercial_report_emails e
    join public.commercial_report_batches b on b.id=e.batch_id
    join public.commercial_report_settings s on s.singleton
    join public.utenti u on u.id=s.owner_id
    join public.ruoli r on r.id=u.ruolo_id
    where e.status='pending' and b.status='queued' and s.enabled
      and now() >= (((b.period + interval '1 month' + (b.delivery_day-1)*interval '1 day')::date + time '10:00') at time zone 'Europe/Rome')
      and s.owner_id=b.owner_id and s.policy_hash=b.policy_hash
      and u.attivo is true and r.amministratore_workspace is true
    order by b.period,(e.delivery_key='aggregate'),e.id
    for update of e skip locked limit 1
  )
  update public.commercial_report_emails e
  set status='uncertain',worker_id=p_worker,lock_token=gen_random_uuid(),claimed_at=now()
  from candidate where e.id=candidate.id returning e.*;
$$;
revoke all on function public.commercial_report_claim_email(text) from public,anon,authenticated;
grant execute on function public.commercial_report_claim_email(text) to service_role;

-- Commit completion and the requested schedule transition together, only after
-- every actual envelope is confirmed sent. Repeated acknowledgements are safe.
create or replace function public.commercial_report_finish_batch(p_batch uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare target public.commercial_report_batches;
begin
  select * into target from public.commercial_report_batches where id=p_batch for update;
  if not found or target.status not in ('queued','sent') then return false; end if;
  if not exists(select 1 from public.commercial_report_emails where batch_id=p_batch)
    or exists(select 1 from public.commercial_report_emails where batch_id=p_batch and status<>'sent') then return false; end if;
  update public.commercial_report_batches set status='sent' where id=p_batch;
  update public.commercial_report_settings
    set delivery_day=next_delivery_day,next_delivery_day=null,schedule_transition_batch_id=null
    where singleton and owner_id=target.owner_id and policy_hash=target.policy_hash
      and schedule_transition_batch_id=p_batch and next_delivery_day is not null;
  return true;
end;
$$;
revoke all on function public.commercial_report_finish_batch(uuid) from public,anon,authenticated;
grant execute on function public.commercial_report_finish_batch(uuid) to service_role;

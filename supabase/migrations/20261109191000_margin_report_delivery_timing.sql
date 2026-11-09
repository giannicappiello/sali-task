-- The approved first PDF is immediate; subsequent periods cannot send before day 10 at 10:00 Rome.
create or replace function public.margin_report_claim(p_worker text,p_policy text)
returns setof public.margin_report_runs language sql security invoker set search_path='' as $$
 with candidate as (
 select j.id from public.margin_report_runs j join public.margin_report_plans p on p.owner_id=j.owner_id
 join public.utenti u on u.id=p.owner_id join public.ruoli r on r.id=u.ruolo_id
 where j.status='queued' and p.enabled and j.policy_hash=p.policy_hash and p.policy_hash=p_policy
 and p.approved_by=p.owner_id and p.approved_at is not null and u.attivo and r.amministratore_workspace
 and (j.created_at<=p.approved_at or now()>=(((j.period+interval '1 month 9 days')::date+time '10:00') at time zone 'Europe/Rome'))
 order by j.created_at for update of j skip locked limit 1
 ) update public.margin_report_runs j set status='uncertain',worker_id=p_worker,lock_token=gen_random_uuid(),claimed_at=now()
 from candidate where j.id=candidate.id returning j.*;
$$;
revoke all on function public.margin_report_claim(text,text) from public,anon,authenticated;
grant execute on function public.margin_report_claim(text,text) to service_role;

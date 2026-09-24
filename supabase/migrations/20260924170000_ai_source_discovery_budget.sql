begin;
-- This counter bounds all worker/model requests, not compilation attempts.
-- The worker independently allows 20 discovery passes and four tested revisions.
alter table public.ai_development_jobs drop constraint ai_development_jobs_generation_count_check;
alter table public.ai_development_jobs add constraint ai_development_jobs_generation_count_check check (generation_count between 0 and 24);
create or replace function public.reserve_ai_development_generation(p_job_id uuid,p_host_id uuid,p_lease_token uuid,p_commit text)
returns setof public.ai_development_jobs language plpgsql security definer set search_path=public as $$
begin
  if p_commit !~ '^[a-f0-9]{40}$' then raise exception 'INVALID_COMMIT'; end if;
  return query update public.ai_development_jobs j set generation_count=j.generation_count+1,source_commit=p_commit
    where j.id=p_job_id and j.host_id=p_host_id and j.lease_token=p_lease_token and j.status='running' and j.lease_until>now()
    and j.generation_count<24 and (j.source_commit is null or j.source_commit=p_commit)
    and exists(select 1 from public.ai_development_hosts h where h.id=p_host_id and h.active)
    and exists(select 1 from public.utenti u join public.ruoli r on r.id=u.ruolo_id where u.id=j.user_id and u.attivo and r.amministratore_workspace)
    returning j.*;
end $$;
revoke all on function public.reserve_ai_development_generation(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_ai_development_generation(uuid,uuid,uuid,text) to service_role;
commit;

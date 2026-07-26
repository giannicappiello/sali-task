-- Rende nuovamente reclamabili i job lasciati leased/running da worker terminati.
create or replace function public.recover_expired_mexal_sync_jobs()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_recovered integer;
begin
  update public.mexal_sync_jobs
     set status = 'retry',
         available_at = now(),
         leased_at = null,
         lease_expires_at = null,
         heartbeat_at = null,
         worker_id = null,
         lock_token = null,
         updated_at = now()
   where status in ('leased', 'running')
     and lease_expires_at is not null
     and lease_expires_at <= now()
     and attempts < max_attempts;

  get diagnostics v_recovered = row_count;
  return v_recovered;
end;
$$;

revoke all on function public.recover_expired_mexal_sync_jobs()
from public, anon, authenticated;

grant execute on function public.recover_expired_mexal_sync_jobs()
to service_role;

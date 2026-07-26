begin;

alter table public.ordini_email_invio
  add column if not exists provider text,
  add column if not exists provider_message_id text;

create index if not exists ordini_email_invio_provider_message_idx
  on public.ordini_email_invio (provider, provider_message_id)
  where provider_message_id is not null;

create or replace function public.claim_next_order_email(
  p_worker_id text,
  p_lease_seconds integer default 300
)
returns setof public.ordini_email_invio
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email public.ordini_email_invio%rowtype;
  v_lease_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 300), 1800));
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception using errcode = '22023', message = 'worker_id obbligatorio';
  end if;

  update public.ordini_email_invio
     set stato = case when attempts >= max_attempts then 'failed' else 'retry' end,
         available_at = case when attempts >= max_attempts then available_at else now() end,
         last_error = left(
           concat_ws(E'\n', nullif(last_error, ''), 'Lease SMTP scaduto; job recuperato automaticamente.'),
           4000
         ),
         worker_id = null,
         lock_token = null,
         lease_expires_at = null,
         updated_at = now()
   where stato in ('leased', 'sending')
     and lease_expires_at <= now();

  select *
    into v_email
    from public.ordini_email_invio
   where stato in ('queued', 'retry')
     and available_at <= now()
     and attempts < max_attempts
   order by available_at, id
   for update skip locked
   limit 1;

  if not found then
    return;
  end if;

  update public.ordini_email_invio
     set stato = 'leased',
         attempts = attempts + 1,
         worker_id = btrim(p_worker_id),
         lock_token = gen_random_uuid(),
         lease_expires_at = now() + pg_catalog.make_interval(secs => v_lease_seconds),
         last_error = null,
         updated_at = now()
   where id = v_email.id
  returning * into v_email;

  return next v_email;
end;
$$;

create or replace function public.complete_order_email(
  p_email_id bigint,
  p_worker_id text,
  p_lock_token uuid,
  p_provider text,
  p_provider_message_id text
)
returns public.ordini_email_invio
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email public.ordini_email_invio%rowtype;
begin
  update public.ordini_email_invio
     set stato = 'sent',
         provider = nullif(btrim(p_provider), ''),
         provider_message_id = nullif(btrim(p_provider_message_id), ''),
         sent_at = now(),
         last_error = null,
         worker_id = null,
         lock_token = null,
         lease_expires_at = null,
         updated_at = now()
   where id = p_email_id
     and worker_id = p_worker_id
     and lock_token = p_lock_token
     and stato in ('leased', 'sending')
     and lease_expires_at > now()
  returning * into v_email;

  if not found then
    raise exception using errcode = 'P0001', message = 'Lease email non valida o scaduta';
  end if;

  return v_email;
end;
$$;

create or replace function public.retry_order_email(
  p_email_id bigint,
  p_worker_id text,
  p_lock_token uuid,
  p_error text,
  p_permanent boolean default false
)
returns public.ordini_email_invio
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email public.ordini_email_invio%rowtype;
begin
  update public.ordini_email_invio
     set stato = case
           when coalesce(p_permanent, false) or attempts >= max_attempts then 'failed'
           else 'retry'
         end,
         available_at = case
           when coalesce(p_permanent, false) or attempts >= max_attempts then available_at
           else now() + pg_catalog.make_interval(
             secs => least(3600, 60 * greatest(1, attempts))
           )
         end,
         last_error = left(coalesce(nullif(p_error, ''), 'Invio SMTP non riuscito'), 4000),
         worker_id = null,
         lock_token = null,
         lease_expires_at = null,
         updated_at = now()
   where id = p_email_id
     and worker_id = p_worker_id
     and lock_token = p_lock_token
     and stato in ('leased', 'sending')
  returning * into v_email;

  if not found then
    raise exception using errcode = 'P0001', message = 'Lease email non valida';
  end if;

  return v_email;
end;
$$;

revoke all on function public.claim_next_order_email(text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_order_email(bigint, text, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.retry_order_email(bigint, text, uuid, text, boolean)
  from public, anon, authenticated;

grant execute on function public.claim_next_order_email(text, integer)
  to service_role;
grant execute on function public.complete_order_email(bigint, text, uuid, text, text)
  to service_role;
grant execute on function public.retry_order_email(bigint, text, uuid, text, boolean)
  to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare
  v_job_id bigint;
begin
  select jobid
    into v_job_id
    from cron.job
   where jobname = 'order-email-worker-every-minute';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

select cron.schedule(
  'order-email-worker-every-minute',
  '* * * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'SUPABASE_URL'
    ) || '/functions/v1/order-email-worker',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-order-email-worker-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'WORKER_SECRET'
      )
    ),
    body := '{"source":"supabase_cron"}'::jsonb
  );
  $cron$
);

commit;

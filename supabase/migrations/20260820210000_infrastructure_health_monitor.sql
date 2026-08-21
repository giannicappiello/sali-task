begin;

create table if not exists public.infrastruttura_monitor_stato (
  codice text primary key,
  nome text not null,
  url text not null,
  stato text not null default 'sconosciuto'
    check (stato in ('sconosciuto', 'attivo', 'non_raggiungibile')),
  errori_consecutivi integer not null default 0 check (errori_consecutivi >= 0),
  ultimo_status_code integer,
  ultima_latenza_ms integer,
  ultimo_errore text,
  ultimo_controllo timestamptz,
  ultimo_successo timestamptz,
  ultimo_errore_il timestamptz,
  ultima_notifica_il timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.infrastruttura_monitor_stato enable row level security;

insert into public.notifiche_regole
  (codice, nome, descrizione, gruppo, attiva, push_attiva, suono_attivo, anticipo_minuti)
values
  ('infrastruttura_non_raggiungibile', 'Servizio non raggiungibile', 'Avvisa gli amministratori dopo due controlli consecutivi falliti.', 'Sistema', true, true, true, '{}'),
  ('infrastruttura_ripristinata', 'Servizio ripristinato', 'Conferma agli amministratori che un servizio è tornato raggiungibile.', 'Sistema', true, true, true, '{}')
on conflict (codice) do update
set nome = excluded.nome,
    descrizione = excluded.descrizione,
    gruppo = excluded.gruppo,
    updated_at = now();

create or replace function public.registra_controllo_infrastruttura(
  p_codice text,
  p_nome text,
  p_url text,
  p_ok boolean,
  p_status_code integer default null,
  p_latenza_ms integer default null,
  p_errore text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_precedente public.infrastruttura_monitor_stato%rowtype;
  v_nuovo_stato text;
  v_errori integer;
  v_transizione text := null;
  v_notifica_creata boolean := false;
  v_url_workspace text := '/settings/notifications';
begin
  if nullif(btrim(p_codice), '') is null or nullif(btrim(p_nome), '') is null then
    raise exception using errcode = '22023', message = 'Codice e nome monitor obbligatori';
  end if;

  insert into public.infrastruttura_monitor_stato (codice, nome, url)
  values (btrim(p_codice), btrim(p_nome), btrim(p_url))
  on conflict (codice) do nothing;

  select * into strict v_precedente
  from public.infrastruttura_monitor_stato
  where codice = btrim(p_codice)
  for update;

  if coalesce(p_ok, false) then
    v_errori := 0;
    v_nuovo_stato := 'attivo';
    if v_precedente.stato = 'non_raggiungibile' then
      v_transizione := 'ripristinato';
      insert into public.notifiche (
        utente_id, titolo, messaggio, tipo, evento, url, priorita, metadata
      )
      select
        u.id,
        p_nome || ' ripristinato',
        p_nome || ' è nuovamente raggiungibile.',
        'sistema',
        'infrastruttura_ripristinata',
        v_url_workspace,
        'normale',
        jsonb_build_object('monitor', p_codice, 'status_code', p_status_code, 'latenza_ms', p_latenza_ms)
      from public.utenti u
      join public.ruoli r on r.id = u.ruolo_id
      where coalesce(u.attivo, true) = true
        and (coalesce(r.amministratore_workspace, false) or r.livello_accesso = 'amministrazione');
      v_notifica_creata := found;
    end if;
  else
    v_errori := v_precedente.errori_consecutivi + 1;
    v_nuovo_stato := case when v_errori >= 2 then 'non_raggiungibile' else v_precedente.stato end;
    if v_errori >= 2 and v_precedente.stato <> 'non_raggiungibile' then
      v_transizione := 'guasto';
      insert into public.notifiche (
        utente_id, titolo, messaggio, tipo, evento, url, priorita, metadata
      )
      select
        u.id,
        p_nome || ' non raggiungibile',
        p_nome || ' non risponde da due controlli consecutivi. Verificare alimentazione, servizio e tunnel Cloudflare.',
        'sistema',
        'infrastruttura_non_raggiungibile',
        v_url_workspace,
        'alta',
        jsonb_build_object('monitor', p_codice, 'status_code', p_status_code, 'errore', left(coalesce(p_errore, ''), 500))
      from public.utenti u
      join public.ruoli r on r.id = u.ruolo_id
      where coalesce(u.attivo, true) = true
        and (coalesce(r.amministratore_workspace, false) or r.livello_accesso = 'amministrazione');
      v_notifica_creata := found;
    end if;
  end if;

  update public.infrastruttura_monitor_stato
  set nome = btrim(p_nome),
      url = btrim(p_url),
      stato = v_nuovo_stato,
      errori_consecutivi = v_errori,
      ultimo_status_code = p_status_code,
      ultima_latenza_ms = p_latenza_ms,
      ultimo_errore = case when p_ok then null else left(coalesce(p_errore, 'Connessione non riuscita'), 1000) end,
      ultimo_controllo = now(),
      ultimo_successo = case when p_ok then now() else ultimo_successo end,
      ultimo_errore_il = case when p_ok then ultimo_errore_il else now() end,
      ultima_notifica_il = case when v_notifica_creata then now() else ultima_notifica_il end,
      updated_at = now()
  where codice = btrim(p_codice);

  return jsonb_build_object(
    'code', btrim(p_codice),
    'state', v_nuovo_stato,
    'consecutive_failures', v_errori,
    'transition', v_transizione,
    'notification_created', v_notifica_creata
  );
end;
$$;

revoke all on table public.infrastruttura_monitor_stato from public, anon, authenticated;
revoke all on function public.registra_controllo_infrastruttura(text, text, text, boolean, integer, integer, text)
  from public, anon, authenticated;
grant all on table public.infrastruttura_monitor_stato to service_role;
grant execute on function public.registra_controllo_infrastruttura(text, text, text, boolean, integer, integer, text)
  to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'infrastructure-health-monitor-every-5-minutes';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

select cron.schedule(
  'infrastructure-health-monitor-every-5-minutes',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := (
      select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL'
    ) || '/functions/v1/infrastructure-health-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-infrastructure-worker-secret', (
        select decrypted_secret from vault.decrypted_secrets where name = 'WORKER_SECRET'
      )
    ),
    body := '{"source":"supabase_cron"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);

commit;

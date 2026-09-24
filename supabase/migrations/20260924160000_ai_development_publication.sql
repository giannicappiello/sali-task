begin;
alter table public.ai_development_jobs add column publish_requested boolean not null default false;
alter table public.ai_development_jobs add column source_job_id uuid references public.ai_development_jobs(id);
create unique index ai_development_publication_source on public.ai_development_jobs(source_job_id) where source_job_id is not null;
alter table public.ai_development_jobs drop constraint ai_development_jobs_status_check;
alter table public.ai_development_jobs add constraint ai_development_jobs_status_check
  check(status in ('proposed','queued','running','review','published','failed','interrupted','rejected'));

-- Resume only a persisted, tested publication checkpoint. Never replay business writes.
create or replace function public.claim_ai_development_job(p_host_id uuid)
returns setof public.ai_development_jobs language plpgsql security definer set search_path=public as $$
declare selected_id uuid;
begin
  if not exists(select 1 from public.ai_development_hosts where id=p_host_id and active) then raise exception 'HOST_DISABLED'; end if;
  update public.ai_development_jobs set status=case when publish_requested and result->'revision'->>'commit' ~ '^[a-f0-9]{40}$' then 'queued' else 'interrupted' end,
    error='Sessione scaduta. Pubblicazione verificata da riconciliare, oppure elaborazione interrotta.'
    where status='running' and lease_until < now();
  select j.id into selected_id from public.ai_development_jobs j where j.status='queued'
    and exists(select 1 from public.utenti u join public.ruoli r on r.id=u.ruolo_id where u.id=j.user_id and u.attivo and r.amministratore_workspace)
    order by j.created_at,j.id for update skip locked limit 1;
  if selected_id is null then return; end if;
  return query update public.ai_development_jobs set status='running',host_id=p_host_id,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    where id=selected_id returning *;
end $$;

create function public.notify_ai_development_completion()
returns trigger language plpgsql security definer set search_path=public as $$
declare message text;
begin
  if new.status=old.status or new.status not in ('published','review','failed','interrupted') or new.conversation_id is null then return new; end if;
  if not exists(select 1 from public.ai_conversazioni where id=new.conversation_id and utente_id=new.user_id) then return new; end if;
  message:=case when new.status='published' then
    case when new.repository='mes' then 'Sorgenti MES pubblicati su main. Ora aggiorna MES sul server.' else 'Workspace pubblicato su main e verificato in produzione su https://workspace.progre.it.' end
    || E'\nCommit: ' || coalesce(new.result->'revision'->>'commit','')
    when new.status='review' then 'Modifica completata e testata, senza pubblicazione come richiesto.'
    else 'Lavoro non completato: ' || coalesce(new.error,'Verifica necessaria.') || case when new.result->'publication'->>'mainCommit' is not null then E'\nIl commit è già su main; la produzione richiede verifica. Non ripetere la modifica.' else '' end end;
  insert into public.ai_messaggi(id,conversazione_id,ruolo,contenuto,fonti,metadati)
    values(new.id,new.conversation_id,'assistant',message,'[]'::jsonb,jsonb_build_object('developmentJobId',new.id,'developmentStatus',new.status))
    on conflict(id) do update set contenuto=excluded.contenuto,metadati=excluded.metadati;
  update public.ai_conversazioni set aggiornata_il=now() where id=new.conversation_id;
  return new;
end $$;
create trigger ai_development_completion_message after update of status on public.ai_development_jobs
for each row execute function public.notify_ai_development_completion();
revoke all on function public.notify_ai_development_completion() from public,anon,authenticated;
commit;

begin;
alter table public.ai_development_jobs drop constraint ai_development_jobs_status_check;
alter table public.ai_development_jobs add constraint ai_development_jobs_status_check check(status in ('proposed','queued','running','publishing','review','published','failed','interrupted','rejected','cancelled'));

-- Both operations lock/update the same row. A cancelled job can never acquire publication.
create or replace function public.cancel_ai_development_job(p_job_id uuid,p_user_id uuid)
returns setof public.ai_development_jobs language plpgsql security definer set search_path=public as $$
begin
  return query update public.ai_development_jobs j set status='cancelled',publish_requested=false,lease_token=null,lease_until=null,finished_at=now(),error='Annullato dal richiedente.'
  where j.id=p_job_id and j.user_id=p_user_id and j.status in ('proposed','queued','running','review','cancelled')
  and exists(select 1 from public.utenti u join public.ruoli r on r.id=u.ruolo_id where u.id=p_user_id and u.attivo and r.amministratore_workspace)
  returning j.*;
end $$;
create or replace function public.begin_ai_development_publication(p_job_id uuid,p_host_id uuid,p_lease_token uuid)
returns setof public.ai_development_jobs language plpgsql security definer set search_path=public as $$
begin
  return query update public.ai_development_jobs j set status='publishing',lease_until=now()+interval '5 minutes'
  where j.id=p_job_id and j.host_id=p_host_id and j.lease_token=p_lease_token and j.lease_until>now()
  and j.status='running' and j.publish_requested and j.result->'revision'->>'commit' ~ '^[a-f0-9]{40}$'
  and exists(select 1 from public.ai_development_hosts h where h.id=p_host_id and h.active)
  and exists(select 1 from public.utenti u join public.ruoli r on r.id=u.ruolo_id where u.id=j.user_id and u.attivo and r.amministratore_workspace)
  returning j.*;
end $$;
revoke all on function public.cancel_ai_development_job(uuid,uuid), public.begin_ai_development_publication(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_ai_development_job(uuid,uuid), public.begin_ai_development_publication(uuid,uuid,uuid) to service_role;
create or replace function public.claim_ai_development_job(p_host_id uuid)
returns setof public.ai_development_jobs language plpgsql security definer set search_path=public as $$
declare selected_id uuid;
begin
  if not exists(select 1 from public.ai_development_hosts where id=p_host_id and active) then raise exception 'HOST_DISABLED'; end if;
  update public.ai_development_jobs set status='interrupted',finished_at=now(),
    error=case when status='publishing' then 'Pubblicazione interrotta: verificare commit remoto e deployment prima di riprendere.' else 'Sessione worker scaduta: controllare il risultato prima di riprendere.' end
    where status in ('running','publishing') and lease_until < now();
  select j.id into selected_id from public.ai_development_jobs j where j.status='queued'
    and exists(select 1 from public.utenti u join public.ruoli r on r.id=u.ruolo_id where u.id=j.user_id and u.attivo and r.amministratore_workspace)
    order by j.created_at,j.id for update skip locked limit 1;
  if selected_id is null then return; end if;
  return query update public.ai_development_jobs set status='running',host_id=p_host_id,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    where id=selected_id returning *;
end $$;


create or replace function public.notify_ai_development_completion()
returns trigger language plpgsql security definer set search_path=public as $$
declare message text;
begin
  if new.status=old.status or new.status not in ('published','review','failed','interrupted','cancelled') or new.conversation_id is null then return new; end if;
  if not exists(select 1 from public.ai_conversazioni where id=new.conversation_id and utente_id=new.user_id) then return new; end if;
  message:=case when new.status='published' then
    case when new.repository='mes' then 'Sorgenti MES pubblicati su main. Ora aggiorna MES sul server.' else 'Workspace pubblicato su main; deployment disponibile su https://workspace.progre.it. Il collaudo funzionale della schermata non è attestato da questo controllo.' end
    || E'\nCommit: ' || coalesce(new.result->'revision'->>'commit','')
    when new.status='cancelled' then 'Lavoro annullato. Nessuna pubblicazione sarà avviata da questo lavoro.'
    when new.status='review' then 'Modifica completata e testata, senza pubblicazione come richiesto.'
    else 'Lavoro non completato: ' || coalesce(new.error,'Verifica necessaria.') || case when new.result->'publication'->>'mainCommit' is not null then E'\nIl commit è già su main; la produzione richiede verifica. Non ripetere la modifica.' else '' end end;
  insert into public.ai_messaggi(id,conversazione_id,ruolo,contenuto,fonti,metadati)
    values(new.id,new.conversation_id,'assistant',message,'[]'::jsonb,jsonb_build_object('developmentJobId',new.id,'developmentStatus',new.status))
    on conflict(id) do update set contenuto=excluded.contenuto,metadati=excluded.metadati;
  update public.ai_conversazioni set aggiornata_il=now() where id=new.conversation_id;
  return new;
end $$;

commit;

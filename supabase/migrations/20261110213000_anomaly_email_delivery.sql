begin;
alter table public.anomaly_agents alter column readiness set default '{"ready":false,"emailReady":false,"reason":"Da verificare: fonti, recapito testuale e destinatari autorizzati."}'::jsonb;
alter table public.anomaly_deliveries
 add column if not exists recipient_email text,
 add column if not exists subject text,
 add column if not exists body text,
 add column if not exists worker_id text,
 add column if not exists lock_token uuid,
 add column if not exists sent_at timestamptz;
update public.anomaly_agents set readiness=jsonb_build_object('ready',false,'emailReady',false,
 'reason','Verifica aggiornata: fonti, email testuale e destinatari autorizzati. Invii disattivati.')
where code='fabbisogni' and readiness->>'reason' ilike '%PDF%';
create function public.anomaly_guard_activation() returns trigger
language plpgsql set search_path=public as $$
begin
 if new.enabled and (coalesce((new.readiness->>'ready')::boolean,false) is not true
  or coalesce((new.readiness->>'emailReady')::boolean,false) is not true) then raise exception 'AGENT_NOT_READY'; end if;
 return new;
end $$;
revoke all on function public.anomaly_guard_activation() from public,anon,authenticated;
create trigger anomaly_activation_guard before update of enabled,readiness on public.anomaly_agents
for each row execute function public.anomaly_guard_activation();
-- Text-only daily email queue. Claims become uncertain before SMTP handoff;
-- uncertain deliveries are never retried automatically.

create function public.anomaly_queue_email(p_actor uuid,p_run uuid,p_jobs jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare j jsonb; inserted integer:=0; run public.anomaly_runs; actor public.utenti; recipient public.utenti; actor_admin boolean; recipient_admin boolean; scope_departments uuid[];
begin
 select u.* into actor from public.utenti u where u.id=p_actor and u.attivo is true;
 select coalesce(r.amministratore_workspace,false) into actor_admin from public.ruoli r where r.id=actor.ruolo_id;
 if not found or not actor_admin or not 'anomalie'=any(public.workspace_area_access_codes(actor.auth_user_id)) then raise exception 'ACTOR_NOT_AUTHORIZED' using errcode='42501'; end if;
 if not public.workspace_module_enabled_for_user(actor.id,'anomalie') or not public.workspace_module_enabled_for_user(actor.id,'progremes') or not public.workspace_module_enabled_for_user(actor.id,'magazzino') then raise exception 'ACTOR_SOURCE_SCOPE_REQUIRED' using errcode='42501'; end if;
 select * into run from public.anomaly_runs where id=p_run for update;
 if not found or run.status not in ('complete','incomplete') or jsonb_typeof(p_jobs) is distinct from 'array' or jsonb_array_length(p_jobs)>200 then raise exception 'INVALID_DELIVERY_BATCH'; end if;
 if (select enabled from public.anomaly_agents where code='fabbisogni') is not true or
   (select readiness->>'emailReady' from public.anomaly_agents where code='fabbisogni') is distinct from 'true' then raise exception 'EMAIL_DELIVERY_NOT_READY'; end if;
 for j in select * from jsonb_array_elements(p_jobs) loop
  if coalesce(j->>'channel','')<>'email' or length(coalesce(j->>'subject','')) not between 1 and 200 or length(coalesce(j->>'body',''))>20000
   or coalesce(j->>'content_hash','') !~ '^[a-f0-9]{64}$' or coalesce(j->>'recipient_email','') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
   or not (j ? 'scope_department_ids') or jsonb_typeof(j->'scope_department_ids') not in ('null','array') then raise exception 'INVALID_DELIVERY'; end if;
  scope_departments:=case when jsonb_typeof(j->'scope_department_ids')='array' then array(select jsonb_array_elements_text(j->'scope_department_ids')::uuid) else null end;
  select u.* into recipient from public.utenti u where u.id=(j->>'recipient_id')::uuid and u.attivo is true;
  select coalesce(r.amministratore_workspace,false) into recipient_admin from public.ruoli r where r.id=recipient.ruolo_id;
  if not found or lower(btrim(recipient.email))<>lower(btrim(j->>'recipient_email'))
   or not 'anomalie'=any(public.workspace_area_access_codes(recipient.auth_user_id))
   or not public.workspace_module_enabled_for_user(recipient.id,'anomalie')
   or not public.workspace_module_enabled_for_user(recipient.id,'progremes')
   or not public.workspace_module_enabled_for_user(recipient.id,'magazzino') then raise exception 'RECIPIENT_OR_AGENT_NOT_AUTHORIZED'; end if;
  if scope_departments is null then
   if not recipient_admin then raise exception 'GLOBAL_REPORT_REQUIRES_ADMIN'; end if;
  else
   if cardinality(scope_departments)=0 then raise exception 'EMPTY_REPORT_SCOPE'; end if;
   if not recipient_admin and exists(select 1 from unnest(scope_departments) d where d is distinct from recipient.reparto_id
    and not exists(select 1 from public.utenti_reparti ur where ur.utente_id=recipient.id and ur.reparto_id=d)
    and not exists(select 1 from public.utenti_reparti ur join public.utenti member on member.id=ur.utente_id where ur.reparto_id=d and member.responsabile_utente_id=recipient.id)) then raise exception 'RECIPIENT_DEPARTMENT_SCOPE_REQUIRED'; end if;
   if exists(select 1 from unnest(scope_departments) d where not exists(select 1 from public.reparti r where r.id=d and r.attivo is true)) then raise exception 'INACTIVE_REPORT_SCOPE'; end if;
  end if;
  insert into public.anomaly_deliveries(run_id,recipient_id,channel,content_hash,status,recipient_email,subject,body)
  values(p_run,recipient.id,'email',j->>'content_hash','pending',lower(btrim(j->>'recipient_email')),j->>'subject',j->>'body')
  on conflict(run_id,recipient_id,channel,content_hash) do nothing;
  if found then inserted:=inserted+1; end if;
 end loop;
 return inserted;
end $$;
revoke all on function public.anomaly_queue_email(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.anomaly_queue_email(uuid,uuid,jsonb) to service_role;

create function public.anomaly_claim_email(p_worker text) returns setof public.anomaly_deliveries
language sql security definer set search_path=public as $$
 with candidate as (
  select d.id from public.anomaly_deliveries d join public.anomaly_runs r on r.id=d.run_id
  join public.anomaly_agents a on a.code=r.agent_code join public.utenti u on u.id=d.recipient_id
  where d.status='pending' and d.channel='email' and a.enabled and u.attivo
   and 'anomalie'=any(public.workspace_area_access_codes(u.auth_user_id))
   and public.workspace_module_enabled_for_user(u.id,'anomalie')
   and public.workspace_module_enabled_for_user(u.id,'progremes')
   and public.workspace_module_enabled_for_user(u.id,'magazzino')
  order by d.created_at,d.id for update of d skip locked limit 1
 ) update public.anomaly_deliveries d set status='uncertain',worker_id=p_worker,lock_token=gen_random_uuid()
 from candidate where d.id=candidate.id returning d.*;
$$;
revoke all on function public.anomaly_claim_email(text) from public,anon,authenticated;
grant execute on function public.anomaly_claim_email(text) to service_role;

create function public.anomaly_finish_email(p_id uuid,p_worker text,p_lock uuid,p_status text,p_receipt text default null) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if p_status not in ('accepted','delivered','uncertain','failed') then raise exception 'INVALID_DELIVERY_STATUS'; end if;
 update public.anomaly_deliveries set status=p_status,provider_receipt=left(p_receipt,1000),sent_at=case when p_status in ('accepted','delivered') then now() else sent_at end
 where id=p_id and worker_id=p_worker and lock_token=p_lock and status='uncertain';
 return found;
end $$;
revoke all on function public.anomaly_finish_email(uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.anomaly_finish_email(uuid,text,uuid,text,text) to service_role;

drop function if exists public.anomaly_set_readiness(jsonb);
create function public.anomaly_set_readiness(p_actor uuid,p_ready jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
declare actor public.utenti; actor_admin boolean;
begin
 select u.* into actor from public.utenti u where u.id=p_actor and u.attivo is true;
 select coalesce(r.amministratore_workspace,false) into actor_admin from public.ruoli r where r.id=actor.ruolo_id;
 if not found or not actor_admin or not 'anomalie'=any(public.workspace_area_access_codes(actor.auth_user_id))
  or not public.workspace_module_enabled_for_user(actor.id,'anomalie') or not public.workspace_module_enabled_for_user(actor.id,'progremes')
  or not public.workspace_module_enabled_for_user(actor.id,'magazzino') then raise exception 'READINESS_ACTOR_NOT_AUTHORIZED' using errcode='42501'; end if;
 if jsonb_typeof(p_ready) is distinct from 'object' or jsonb_typeof(p_ready->'coverage') is distinct from 'object'
  or jsonb_typeof(p_ready->'email') is distinct from 'object' or jsonb_typeof(p_ready->'recipients') is distinct from 'object'
  or not (p_ready ?& array['ready','emailReady','reason','checkedAt','coverage','email','recipients']) then raise exception 'INVALID_READINESS'; end if;
 if coalesce((p_ready->>'ready')::boolean,false) and (coalesce((p_ready->>'emailReady')::boolean,false) is not true
  or coalesce((p_ready->'email'->>'ready')::boolean,false) is not true
  or coalesce((p_ready->'recipients'->>'ready')::boolean,false) is not true) then raise exception 'READINESS_REQUIREMENTS_FAILED'; end if;
 update public.anomaly_agents set readiness=p_ready,config_version=config_version+1 where code='fabbisogni';
 return found;
end $$;
revoke all on function public.anomaly_set_readiness(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.anomaly_set_readiness(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

create table public.commercial_report_upload_history (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.commercial_report_batches(id),
  artifact_key text not null,
  actor_id uuid not null references public.utenti(id),
  previous_chunks jsonb not null,
  finalized_sha256 text not null,
  created_at timestamptz not null default now()
);
alter table public.commercial_report_upload_history enable row level security;
revoke all on public.commercial_report_upload_history from public,anon,authenticated;
grant all on public.commercial_report_upload_history to service_role;

-- The authenticated server validates PDF bytes/hash, scope and explicit draft
-- replacement first. This transaction preserves the old draft and finalizes once.
create or replace function public.commercial_report_store_pdf(
  p_actor uuid,p_batch uuid,p_artifact text,p_snapshot jsonb,p_file jsonb
) returns boolean language plpgsql security invoker set search_path='' as $$
declare b public.commercial_report_batches; target jsonb; current_snapshot jsonb; old_chunks jsonb; prior_sha text;
begin
  select * into b from public.commercial_report_batches where id=p_batch for update;
  if not found or b.owner_id<>p_actor then raise exception 'Lotto non accessibile'; end if;
  if not exists(select 1 from public.commercial_report_settings s
    join public.utenti u on u.id=s.owner_id join public.ruoli r on r.id=u.ruolo_id
    where s.singleton and s.enabled and s.owner_id=p_actor and s.policy_hash=b.policy_hash
      and u.attivo is true and r.amministratore_workspace is true) then raise exception 'Delega non attiva'; end if;
  select sha256 into prior_sha from public.commercial_report_files where batch_id=p_batch and artifact_key=p_artifact;
  if found then
    if prior_sha=p_file->>'sha256' then return true; end if;
    raise exception 'PDF finalizzato immutabile';
  end if;
  if b.status<>'requested' or exists(select 1 from public.commercial_report_emails where batch_id=p_batch) then raise exception 'Lotto non disponibile'; end if;
  select t into target from jsonb_array_elements(b.manifest) t where t->>'key'=p_artifact;
  if target is null or p_file->>'batch_id'<>p_batch::text or p_file->>'artifact_key'<>p_artifact
    or p_file->>'period'<>b.period::text or p_file->>'network'<>target->>'network' or p_file->>'source'<>target->>'source'
    or (p_file->>'verified')::boolean is distinct from true or (p_file->>'pages')::int<3
    or (p_file->>'bytes')::int not between 1 and 2000000
    or octet_length(decode(p_file->>'base64','base64'))<>(p_file->>'bytes')::int
    or p_file->>'sha256' !~ '^[a-f0-9]{64}$' then raise exception 'PDF fuori dal piano o non valido'; end if;
  lock table public.commercial_report_chunks in share row exclusive mode;
  select coalesce(jsonb_agg(jsonb_build_object('part',part,'total',total,'md5',md5(base64)) order by part),'[]'::jsonb),
    coalesce(jsonb_agg(to_jsonb(c) order by part),'[]'::jsonb)
    into current_snapshot,old_chunks from public.commercial_report_chunks c where batch_id=p_batch and artifact_key=p_artifact;
  if current_snapshot is distinct from p_snapshot then raise exception 'Caricamento variato: rileggere lo stato'; end if;
  insert into public.commercial_report_upload_history(batch_id,artifact_key,actor_id,previous_chunks,finalized_sha256)
    values(p_batch,p_artifact,p_actor,old_chunks,p_file->>'sha256');
  insert into public.commercial_report_files(batch_id,artifact_key,period,network,source,filename,base64,sha256,bytes,verified,pages)
    values(p_batch,p_artifact,b.period,p_file->>'network',p_file->>'source',p_file->>'filename',p_file->>'base64',p_file->>'sha256',(p_file->>'bytes')::int,true,(p_file->>'pages')::int);
  delete from public.commercial_report_chunks where batch_id=p_batch and artifact_key=p_artifact;
  return true;
end;
$$;
revoke all on function public.commercial_report_store_pdf(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commercial_report_store_pdf(uuid,uuid,text,jsonb,jsonb) to service_role;

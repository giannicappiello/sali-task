begin;
alter table public.warehouse_print_jobs add column copies integer check(copies between 1 and 50);
create function public.warehouse_enqueue_print_copies(p_id uuid,p_request uuid,p_kind text,p_actor uuid,p_copies integer)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare job public.warehouse_print_jobs; original public.warehouse_print_jobs;
begin
 if p_copies is null or p_copies not between 1 and 50 then raise exception 'Numero copie non valido (1–50)';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text||':'||p_kind,0));
 select * into job from public.warehouse_print_jobs where id=p_request;
 if found then
  if job.preparation_id<>p_id or job.document_kind<>p_kind or job.actor<>p_actor or job.copies is distinct from p_copies then raise exception 'Identificativo stampa già usato con dati diversi';end if;
  return to_jsonb(job);
 end if;
 if exists(select 1 from public.warehouse_print_jobs where preparation_id=p_id and document_kind=p_kind and status in('queued','leased','printing','uncertain')) then
  raise exception 'Stampa già in corso o esito da verificare: controlla Configurazioni DDT prima di ristampare';
 end if;
 select * into original from public.warehouse_print_jobs where preparation_id=p_id and document_kind=p_kind and provider_job_id is not null order by created_at desc limit 1;
 perform public.warehouse_enqueue_print(p_id,p_request,p_kind,p_actor);
 update public.warehouse_print_jobs set copies=p_copies,reprint_of=original.id where id=p_request returning * into job;
 if job.printer_id not like 'MES:%' then raise exception 'Seleziona la stampante dell’agente MES in Configurazioni DDT';end if;
 insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload)
 values(p_id,gen_random_uuid(),'print_copies_selected',p_actor,to_jsonb(job)-'token');
 return to_jsonb(job);
end;$$;
revoke all on function public.warehouse_enqueue_print_copies(uuid,uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.warehouse_enqueue_print_copies(uuid,uuid,text,uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;

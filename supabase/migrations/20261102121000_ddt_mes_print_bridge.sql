begin;
alter table public.warehouse_print_jobs add column provider_job_id uuid,add column reprint_of uuid references public.warehouse_print_jobs(id);
create function public.warehouse_mes_print(p_id uuid,p_action text,p_token uuid,p_data jsonb)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare job public.warehouse_print_jobs;next_status text;
begin
 select * into strict job from public.warehouse_print_jobs where id=p_id for update;
 if job.printer_id not like 'MES:%' then return jsonb_build_object('acquired',false,'job',to_jsonb(job));end if;
 if p_action='claim' then
  if job.status in('submitted','failed') or (job.status='printing' and job.lease_expires_at>now()) then return jsonb_build_object('acquired',false,'job',to_jsonb(job));end if;
  update public.warehouse_print_jobs set status='printing',station='MES',token=gen_random_uuid(),lease_expires_at=now()+interval '90 seconds',updated_at=now() where id=p_id returning * into job;
  return jsonb_build_object('acquired',true,'job',to_jsonb(job));
 end if;
 if job.token is distinct from p_token or job.station is distinct from 'MES' then raise exception 'Richiesta stampa non valida';end if;
 if job.status in('submitted','failed') then return to_jsonb(job);end if;
 if p_action='result' then
  if p_data->>'status' not in('Queued','Printing','Completed','Failed') or p_data->>'providerId' is null then raise exception 'Esito MES non valido';end if;
  next_status:=case p_data->>'status' when 'Completed' then 'submitted' when 'Failed' then 'failed' else 'printing' end;
  update public.warehouse_print_jobs set provider_job_id=(p_data->>'providerId')::uuid,status=next_status,error=p_data->>'error',lease_expires_at=now(),updated_at=now() where id=p_id returning * into job;
 elsif p_action='error' then
  update public.warehouse_print_jobs set status='uncertain',error=left(p_data->>'error',2000),lease_expires_at=now(),updated_at=now() where id=p_id returning * into job;
 else raise exception 'Azione MES non valida';end if;
 insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload) values(job.preparation_id,gen_random_uuid(),'print_'||job.status,job.actor,to_jsonb(job)-'token');
 return to_jsonb(job);
end;$$;
revoke all on function public.warehouse_mes_print(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.warehouse_mes_print(uuid,text,uuid,jsonb) to service_role;
-- Associate explicit reprints with the original provider job in the same transaction.
create function public.warehouse_mes_reprint_link() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.event_type='print_manual_reprint' then
  update public.warehouse_print_jobs set reprint_of=(new.payload->>'originalJob')::uuid where id=(new.payload->>'newJob')::uuid;
 end if;
 return new;
end;$$;
create trigger warehouse_mes_reprint_link after insert on public.warehouse_preparation_events for each row execute function public.warehouse_mes_reprint_link();
notify pgrst,'reload schema';
commit;

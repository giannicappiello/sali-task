begin;
create table public.warehouse_printers(id text primary key,station text not null,name text not null,last_seen timestamptz not null default now());
create table public.warehouse_print_jobs(
 id uuid primary key,preparation_id uuid not null,document_kind text not null,printer_id text not null references public.warehouse_printers(id),
 actor uuid not null references public.utenti(id),status text not null default 'queued' check(status in('queued','leased','printing','submitted','uncertain','failed')),
 token uuid,station text,lease_expires_at timestamptz,error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(preparation_id,document_kind) references public.warehouse_preparation_documents(preparation_id,kind)
);
alter table public.warehouse_printers enable row level security;
alter table public.warehouse_print_jobs enable row level security;
revoke all on public.warehouse_printers,public.warehouse_print_jobs from public,anon,authenticated,service_role;
grant select on public.warehouse_printers,public.warehouse_print_jobs to service_role;

create function public.warehouse_enqueue_print(p_id uuid,p_request uuid,p_kind text,p_actor uuid)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare job public.warehouse_print_jobs;printer text;r public.warehouse_order_preparations;
begin
 select * into strict r from public.warehouse_order_preparations where id=p_id;
 if r.status<>'completed' or not exists(select 1 from public.utenti where id=p_actor and attivo is not false) then raise exception 'Ordine o operatore non validi';end if;
 if p_kind<>'bcf_print' and p_kind !~ '^packing_pallet_[a-f0-9-]{36}$' then raise exception 'Documento non stampabile';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into job from public.warehouse_print_jobs where id=p_request;
 if found then
  if job.preparation_id<>p_id or job.document_kind<>p_kind or job.actor<>p_actor then raise exception 'Identificativo stampa già usato';end if;
  return to_jsonb(job);
 end if;
 select case when p_kind='bcf_print' then ddt_printer_id else packing_printer_id end into printer from public.warehouse_preparation_settings where id=true;
 if printer is null or not exists(select 1 from public.warehouse_printers where id=printer and last_seen>now()-interval '10 minutes') then raise exception 'Stampante non configurata o agente offline: apri Configurazioni DDT';end if;
 insert into public.warehouse_print_jobs(id,preparation_id,document_kind,printer_id,actor) values(p_request,p_id,p_kind,printer,p_actor) returning * into job;
 insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload) values(p_id,gen_random_uuid(),'print_queued',p_actor,to_jsonb(job));
 return to_jsonb(job);
end;$$;

create function public.warehouse_print_worker(p_station text,p_action text,p_input jsonb)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare job public.warehouse_print_jobs;name text;printer public.warehouse_printers;expired public.warehouse_print_jobs;
begin
 if p_station !~ '^[A-Za-z0-9_-]{1,80}$' then raise exception 'Postazione non valida';end if;
 if p_action='inventory' then
  if jsonb_typeof(p_input->'printers') is distinct from 'array' or jsonb_array_length(p_input->'printers')>100 then raise exception 'Inventario stampanti non valido';end if;
  -- Disconnected printers stay configured, but cannot silently receive a job.
  update public.warehouse_printers set last_seen='epoch' where station=p_station;
  for name in select jsonb_array_elements_text(p_input->'printers') loop
   if length(name)<1 or length(name)>250 or name ~ '[\r\n]' then raise exception 'Nome stampante non valido';end if;
   insert into public.warehouse_printers(id,station,name,last_seen) values(p_station||':'||name,p_station,name,now())
   on conflict(id) do update set last_seen=now();
  end loop;
  return '{"ok":true}'::jsonb;
 elsif p_action='claim' then
  for expired in select * from public.warehouse_print_jobs where status in('leased','printing') and lease_expires_at<=now() for update skip locked loop
   update public.warehouse_print_jobs set status=case when expired.status='printing' then 'uncertain' else 'queued' end,updated_at=now(),error='Lease agente scaduto' where id=expired.id returning * into expired;
   insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload) values(expired.preparation_id,gen_random_uuid(),'print_lease_expired',expired.actor,to_jsonb(expired));
  end loop;
  select j.* into job from public.warehouse_print_jobs j join public.warehouse_printers p on p.id=j.printer_id where j.status='queued' and p.station=p_station and p.last_seen>now()-interval '10 minutes' order by j.created_at for update of j skip locked limit 1;
  if not found then return null;end if;
  update public.warehouse_print_jobs set status='leased',station=p_station,token=gen_random_uuid(),lease_expires_at=now()+interval '5 minutes',updated_at=now() where id=job.id returning * into job;
  select * into strict printer from public.warehouse_printers where id=job.printer_id;
  return to_jsonb(job)||jsonb_build_object('printerName',printer.name,'document',(select jsonb_build_object('filename',filename,'base64',base64,'sha256',sha256) from public.warehouse_preparation_documents where preparation_id=job.preparation_id and kind=job.document_kind));
 elsif p_action in('printing','submitted','uncertain','failed') then
  select * into strict job from public.warehouse_print_jobs where id=(p_input->>'id')::uuid for update;
  if job.station<>p_station or job.token is distinct from (p_input->>'token')::uuid then raise exception 'Lease stampa non valida';end if;
  if job.status='submitted' and p_action='submitted' then return to_jsonb(job);end if;
  if p_action='printing' and (job.status<>'leased' or job.lease_expires_at<=now()) then raise exception 'Stampa già avviata o lease scaduto';end if;
  if p_action='submitted' and job.status not in('printing','uncertain') then raise exception 'Stampa non avviata';end if;
  if p_action in('uncertain','failed') and job.status not in('leased','printing','uncertain') then raise exception 'Stato stampa non valido';end if;
  update public.warehouse_print_jobs set status=p_action,error=left(p_input->>'error',2000),updated_at=now() where id=job.id returning * into job;
  insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload) values(job.preparation_id,gen_random_uuid(),'print_'||p_action,job.actor,to_jsonb(job)-'token');
  return to_jsonb(job);
 end if;
 raise exception 'Azione stampa non valida';
end;$$;
create function public.warehouse_reprint(p_id uuid,p_request uuid,p_actor uuid,p_reason text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare original public.warehouse_print_jobs;result jsonb;
begin
 select * into strict original from public.warehouse_print_jobs where id=p_id for update;
 if original.status not in('uncertain','failed') or length(btrim(p_reason))<3 or length(p_reason)>1000 then raise exception 'Verifica esito stampa e indica il motivo';end if;
 result:=public.warehouse_enqueue_print(original.preparation_id,p_request,original.document_kind,p_actor);
 insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload)
 select original.preparation_id,p_request,'print_manual_reprint',p_actor,jsonb_build_object('originalJob',p_id,'newJob',p_request,'reason',p_reason)
 where not exists(select 1 from public.warehouse_preparation_events where preparation_id=original.preparation_id and event_id=p_request);
 return result;
end;$$;
revoke all on function public.warehouse_reprint(uuid,uuid,uuid,text),public.warehouse_enqueue_print(uuid,uuid,text,uuid),public.warehouse_print_worker(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.warehouse_reprint(uuid,uuid,uuid,text),public.warehouse_enqueue_print(uuid,uuid,text,uuid),public.warehouse_print_worker(text,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

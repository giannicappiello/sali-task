begin;

alter table public.warehouse_preparation_settings
 add column bcf_contract_verified boolean not null default false,
 add column contract_evidence text not null default '',
 add column ddt_pdf_path text,
 add column backoffice_emails jsonb not null default '[]',
 add column email_subject text not null default 'Documenti spedizione {documento}',
 add column email_body text not null default 'In allegato la bolla {documento} e la packing list dell’ordine {ordine}.',
 add column ddt_printer_id text,add column packing_printer_id text;
alter table public.warehouse_order_preparations
 add column dispatch_snapshot jsonb,
 add column confirmed_document jsonb;

-- Service credentials can append through the functions below, but cannot alter
-- history. Database owners remain a separate trust boundary (see operations doc).
create function public.warehouse_immutable_history() returns trigger
 language plpgsql set search_path=pg_catalog,public as $$begin
 raise exception 'Registro immutabile: aggiungere un nuovo evento correttivo';
end;$$;
create trigger warehouse_events_immutable before update or delete or truncate
 on public.warehouse_preparation_events for each statement execute function public.warehouse_immutable_history();
revoke update,delete,truncate on public.warehouse_preparation_events from service_role;
create function public.warehouse_event_identity() returns trigger
 language plpgsql security definer set search_path=pg_catalog,public as $$
declare label text;current_version integer;
begin
 select nullif(btrim(concat_ws(' ',to_jsonb(u)->>'nome',to_jsonb(u)->>'cognome')),'') into label from public.utenti u where id=new.actor;
 select version into current_version from public.warehouse_order_preparations where id=new.preparation_id;
 new.created_at:=clock_timestamp();
 new.event_type:=coalesce(nullif(new.payload->>'operation',''),new.event_type);
 new.payload:=new.payload||jsonb_build_object('operatorName',coalesce(label,new.actor::text),'afterVersion',current_version);
 return new;
end;$$;
create trigger warehouse_event_identity before insert on public.warehouse_preparation_events for each row execute function public.warehouse_event_identity();

alter function public.warehouse_preparation_mutate(uuid,integer,uuid,uuid,text,jsonb) rename to warehouse_preparation_mutate_v1;
revoke all on function public.warehouse_preparation_mutate_v1(uuid,integer,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

create function public.warehouse_preparation_mutate(p_id uuid,p_version integer,p_event uuid,p_actor uuid,p_action text,p_data jsonb)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare prior public.warehouse_order_preparations;r public.warehouse_order_preparations; v jsonb;s jsonb; old_scan jsonb; scans jsonb:='[]';stamp timestamptz:=clock_timestamp();
begin
 perform pg_advisory_xact_lock(hashtextextended('warehouse-order-preparation',0));
 if p_id is not null then
  select * into strict prior from public.warehouse_order_preparations where id=p_id for update;
  if exists(select 1 from public.warehouse_preparation_events where preparation_id=p_id and event_id=p_event) then
   if p_action='claim_export' then raise exception 'Invio già acquisito' using errcode='40001';end if;
   return to_jsonb(prior);
  end if;
 end if;
 if p_action='save' then
  for s in select value from jsonb_array_elements(p_data->'state'->'scans') loop
   select value into old_scan from jsonb_array_elements(prior.state->'scans') where value->>'id'=s->>'id';
   -- Existing readings retain their original operator/time even after partial corrections.
   s:=s||jsonb_build_object('at',coalesce(old_scan->>'at',stamp::text),'actor',coalesce(old_scan->>'actor',p_actor::text));
   scans:=scans||jsonb_build_array(s);
  end loop;
  p_data:=jsonb_set(p_data,'{state,scans}',scans);
 end if;
 if p_action='claim_export' then
  if prior.status<>'verified' then raise exception 'Riscontro positivo richiesto';end if;
  if p_data->'payload'->>'cod_modulo'<>'F' or p_data->'dispatch'->'recipients' is null then raise exception 'Riepilogo BCF e destinatari richiesti';end if;
 end if;
 p_data:=p_data||jsonb_build_object('beforeVersion',prior.version,'beforeState',prior.state);
 v:=public.warehouse_preparation_mutate_v1(p_id,p_version,p_event,p_actor,p_action,p_data);
 select * into strict r from public.warehouse_order_preparations where id=(v->>'id')::uuid;
 if p_action='create' then
  -- Old preparations may already exist: do not attribute their creation to this caller.
  if r.version=1 and r.created_by=p_actor then
   insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload)
   select r.id,gen_random_uuid(),'created',p_actor,jsonb_build_object('source',r.source,'state',r.state)
   where not exists(select 1 from public.warehouse_preparation_events where preparation_id=r.id);
  end if;
 elsif p_action='verify' then
  r.state:=jsonb_set(r.state,'{packages}',(select coalesce(jsonb_agg(value||'{"closed":true}'::jsonb),'[]') from jsonb_array_elements(r.state->'packages')));
  update public.warehouse_order_preparations set state=r.state where id=r.id;
 elsif p_action='claim_export' then
  r.dispatch_snapshot:=p_data->'dispatch';
  update public.warehouse_order_preparations set dispatch_snapshot=r.dispatch_snapshot where id=r.id;
 elsif p_action='finish' then
  r.confirmed_document:=p_data->'confirmedDocument';
  update public.warehouse_order_preparations set confirmed_document=r.confirmed_document where id=r.id;
 end if;
 return to_jsonb(r);
end;$$;
revoke all on function public.warehouse_preparation_mutate(uuid,integer,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.warehouse_preparation_mutate(uuid,integer,uuid,uuid,text,jsonb) to service_role;

create table public.warehouse_preparation_documents(
 preparation_id uuid not null references public.warehouse_order_preparations(id),
 kind text not null check(kind in('bcf','bcf_print','packing_list') or kind ~ '^packing_pallet_[a-f0-9-]{36}$'),filename text not null,sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 base64 text not null check(length(base64)>0 and length(base64)<=14000000),snapshot jsonb not null,
 created_at timestamptz not null default now(),primary key(preparation_id,kind)
);
create table public.warehouse_shipment_emails(
 id uuid primary key default gen_random_uuid(),preparation_id uuid not null references public.warehouse_order_preparations(id),
 recipient text not null,roles jsonb not null,subject text not null,body text not null,
 status text not null default 'queued' check(status in('queued','leased','sending','retry','uncertain','sent','failed')),
 attempts integer not null default 0,max_attempts integer not null default 5,
 available_at timestamptz not null default now(),lock_token uuid,worker_id text,lease_expires_at timestamptz,
 last_error text,provider_message_id text,sent_at timestamptz,created_at timestamptz not null default now(),
 unique(preparation_id,recipient)
);
create index warehouse_shipment_queue on public.warehouse_shipment_emails(status,available_at);
create table public.warehouse_dispatch_configuration_events(
 id bigint generated always as identity primary key,actor uuid not null references public.utenti(id),
 before_settings jsonb not null,after_settings jsonb not null,created_at timestamptz not null default now()
);
create trigger warehouse_documents_immutable before update or delete or truncate on public.warehouse_preparation_documents
 for each statement execute function public.warehouse_immutable_history();
create trigger warehouse_config_events_immutable before update or delete or truncate on public.warehouse_dispatch_configuration_events
 for each statement execute function public.warehouse_immutable_history();
do $$declare t text;begin
 foreach t in array array['warehouse_preparation_documents','warehouse_shipment_emails','warehouse_dispatch_configuration_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to service_role',t);
 end loop;
end;$$;

create function public.warehouse_configure_preparation(p_actor uuid,p_expected timestamptz,p_settings jsonb)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare old public.warehouse_preparation_settings;next public.warehouse_preparation_settings;
begin
 if not exists(select 1 from public.utenti where id=p_actor and attivo is not false) then raise exception 'Utente non valido';end if;
 select * into strict old from public.warehouse_preparation_settings where id=true for update;
 if p_expected is null or old.updated_at<>p_expected then raise exception 'Configurazione aggiornata: ricarica' using errcode='40001';end if;
 select * into next from jsonb_populate_record(old,p_settings);
 update public.warehouse_preparation_settings set ddt_series=next.ddt_series,default_warehouse=next.default_warehouse,
  box_tare_kg=next.box_tare_kg,pallet_tare_kg=next.pallet_tare_kg,
  bcf_contract_verified=next.bcf_contract_verified,contract_evidence=next.contract_evidence,ddt_pdf_path=next.ddt_pdf_path,
  backoffice_emails=next.backoffice_emails,email_subject=next.email_subject,email_body=next.email_body,
  ddt_printer_id=next.ddt_printer_id,packing_printer_id=next.packing_printer_id,updated_at=clock_timestamp() where id=true returning * into next;
 insert into public.warehouse_dispatch_configuration_events(actor,before_settings,after_settings) values(p_actor,to_jsonb(old),to_jsonb(next));
 return to_jsonb(next);
end;$$;

create function public.warehouse_commit_shipment(p_id uuid,p_files jsonb)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.warehouse_order_preparations;f jsonb;recipient jsonb;ref text;
begin
 select * into strict r from public.warehouse_order_preparations where id=p_id for update;
 if r.status<>'completed' or r.ddt->>'signature'<>'BCF' or r.dispatch_snapshot is null then raise exception 'BCF non confermata';end if;
 if (select count(*) from public.warehouse_preparation_documents where preparation_id=p_id)=3+jsonb_array_length(r.state->'pallets') then return '{"alreadyCommitted":true}'::jsonb;end if;
 if jsonb_array_length(p_files)<>3+jsonb_array_length(r.state->'pallets') or not exists(select 1 from jsonb_array_elements(p_files) x where x->>'kind'='bcf') or not exists(select 1 from jsonb_array_elements(p_files) x where x->>'kind'='bcf_print') or not exists(select 1 from jsonb_array_elements(p_files) x where x->>'kind'='packing_list') then raise exception 'PDF di spedizione incompleti';end if;
 if exists(select 1 from jsonb_array_elements(r.state->'pallets') p where not exists(select 1 from jsonb_array_elements(p_files) file_entry where file_entry->>'kind'='packing_pallet_'||(p->>'id'))) then raise exception 'Packing list bancale mancante';end if;
 for f in select value from jsonb_array_elements(p_files) loop
  insert into public.warehouse_preparation_documents(preparation_id,kind,filename,sha256,base64,snapshot)
  values(p_id,f->>'kind',f->>'filename',f->>'sha256',f->>'base64',jsonb_build_object('ddt',r.ddt,'verification',r.verification,'dispatch',r.dispatch_snapshot));
 end loop;
 ref:='BCF '||(r.ddt->>'series')||'/'||(r.ddt->>'number');
 for recipient in select value from jsonb_array_elements(r.dispatch_snapshot->'recipients') loop
  insert into public.warehouse_shipment_emails(preparation_id,recipient,roles,subject,body)
  values(p_id,recipient->>'email',recipient->'roles',replace(r.dispatch_snapshot->>'subject','{documento}',ref),
   replace(replace(r.dispatch_snapshot->>'body','{documento}',ref),'{ordine}','OCM '||(r.source->>'series')||'/'||(r.source->>'number')));
 end loop;
 insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload)
 values(p_id,gen_random_uuid(),'documents_and_emails_queued',r.updated_by,jsonb_build_object('documents',(select jsonb_agg(x-'base64') from jsonb_array_elements(p_files) x),'recipients',r.dispatch_snapshot->'recipients'));
 return '{"committed":true}'::jsonb;
end;$$;

create function public.warehouse_claim_shipment_email(p_worker text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare job public.warehouse_shipment_emails;expired public.warehouse_shipment_emails;operator uuid;
begin
 if nullif(btrim(p_worker),'') is null then raise exception 'Worker richiesto';end if;
 for expired in select * from public.warehouse_shipment_emails where status in('leased','sending') and lease_expires_at<=now() for update skip locked loop
  update public.warehouse_shipment_emails set status=case when expired.status='sending' then 'uncertain' when attempts>=max_attempts then 'failed' else 'retry' end,last_error='Lease scaduto' where id=expired.id returning * into expired;
  select updated_by into operator from public.warehouse_order_preparations where id=expired.preparation_id;
  insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload) values(expired.preparation_id,gen_random_uuid(),'email_lease_expired',operator,jsonb_build_object('emailId',expired.id,'status',expired.status,'worker',expired.worker_id));
 end loop;
 select * into job from public.warehouse_shipment_emails where status in('queued','retry') and available_at<=now() and attempts<max_attempts order by available_at,id for update skip locked limit 1;
 if not found then return null;end if;
 update public.warehouse_shipment_emails set status='leased',attempts=attempts+1,lock_token=gen_random_uuid(),worker_id=p_worker,lease_expires_at=now()+interval '5 minutes' where id=job.id returning * into job;
 select updated_by into operator from public.warehouse_order_preparations where id=job.preparation_id;
 insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload) values(job.preparation_id,gen_random_uuid(),'email_claimed',operator,jsonb_build_object('emailId',job.id,'attempt',job.attempts,'worker',p_worker));
 return to_jsonb(job);
end;$$;

create function public.warehouse_update_shipment_email(p_id uuid,p_worker text,p_token uuid,p_action text,p_message text default '',p_definitive boolean default false)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare job public.warehouse_shipment_emails;operator uuid;
begin
 select * into strict job from public.warehouse_shipment_emails where id=p_id for update;
 if job.worker_id is distinct from p_worker or job.lock_token is distinct from p_token then raise exception 'Lease email non valida';end if;
 if p_action='sending' then
  if job.status<>'leased' or job.lease_expires_at<=now() then raise exception 'Lease email scaduta';end if;
  job.status:='sending';
 elsif p_action='complete' then
  if job.status not in('sending','uncertain','sent') then raise exception 'Invio non avviato';end if;
  job.status:='sent';job.sent_at:=coalesce(job.sent_at,clock_timestamp());job.provider_message_id:=p_message;
 elsif p_action in('retry','failed') then
  if job.status='sent' then return to_jsonb(job);end if;
  if job.status not in('leased','sending','uncertain') then raise exception 'Invio non acquisito';end if;
  job.status:=case when p_action='failed' then 'failed' when job.status in('sending','uncertain') and not p_definitive then 'uncertain' when job.attempts>=job.max_attempts then 'failed' else 'retry' end;
  job.last_error:=left(p_message,4000);job.available_at:=now()+make_interval(secs=>least(3600,60*job.attempts));
 else raise exception 'Azione email non valida';end if;
 update public.warehouse_shipment_emails set status=job.status,sent_at=job.sent_at,provider_message_id=job.provider_message_id,last_error=job.last_error,available_at=job.available_at where id=job.id;
 select updated_by into operator from public.warehouse_order_preparations where id=job.preparation_id;
 insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload) values(job.preparation_id,gen_random_uuid(),'email_'||p_action,operator,jsonb_build_object('emailId',job.id,'status',job.status,'attempt',job.attempts,'message',p_message,'worker',p_worker));
 return to_jsonb(job);
end;$$;

create function public.warehouse_resolve_shipment_email(p_id uuid,p_actor uuid,p_outcome text,p_reason text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare job public.warehouse_shipment_emails;
begin
 if not exists(select 1 from public.utenti where id=p_actor and attivo is not false) or length(btrim(p_reason))<3 or length(p_reason)>1000 then raise exception 'Operatore e motivo richiesti';end if;
 select * into strict job from public.warehouse_shipment_emails where id=p_id for update;
 if job.status not in('uncertain','failed') or p_outcome not in('sent','retry') then raise exception 'Esito email non risolvibile';end if;
 update public.warehouse_shipment_emails set status=p_outcome,available_at=now(),
  attempts=case when p_outcome='retry' then 0 else attempts end,
  sent_at=case when p_outcome='sent' then coalesce(sent_at,now()) else sent_at end,
  worker_id=null,lock_token=null,lease_expires_at=null,last_error=null where id=p_id returning * into job;
 insert into public.warehouse_preparation_events(preparation_id,event_id,event_type,actor,payload)
 values(job.preparation_id,gen_random_uuid(),'email_manual_resolution',p_actor,jsonb_build_object('emailId',p_id,'outcome',p_outcome,'reason',p_reason));
 return to_jsonb(job);
end;$$;

do $$declare f regprocedure;begin
 foreach f in array array['public.warehouse_resolve_shipment_email(uuid,uuid,text,text)'::regprocedure,'public.warehouse_configure_preparation(uuid,timestamptz,jsonb)'::regprocedure,'public.warehouse_commit_shipment(uuid,jsonb)'::regprocedure,'public.warehouse_claim_shipment_email(text)'::regprocedure,'public.warehouse_update_shipment_email(uuid,text,uuid,text,text,boolean)'::regprocedure] loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end;$$;
notify pgrst,'reload schema';
commit;

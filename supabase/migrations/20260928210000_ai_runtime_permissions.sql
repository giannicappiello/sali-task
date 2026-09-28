begin;
create table public.ai_development_permissions (
  user_id uuid primary key references public.utenti(id),
  develop boolean not null default false,
  publish boolean not null default false,
  browser boolean not null default false,
  database boolean not null default false,
  updated_by uuid references public.utenti(id),
  updated_at timestamptz not null default now(),
  check (not publish or develop)
);
alter table public.ai_development_permissions enable row level security;
revoke all on public.ai_development_permissions from anon,authenticated;
grant all on public.ai_development_permissions to service_role;
create function public.ai_development_allowed(p_user uuid,p_capability text)
returns boolean language sql stable security definer set search_path=public as $$
select coalesce((select u.attivo and (r.amministratore_workspace or
 case p_capability when 'develop' then p.develop when 'publish' then p.publish when 'browser' then p.browser when 'database' then p.database else false end)
 from utenti u join ruoli r on r.id=u.ruolo_id left join ai_development_permissions p on p.user_id=u.id where u.id=p_user),false)
$$;
create function public.set_ai_development_permissions(p_admin uuid,p_user uuid,p_permissions jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from utenti u join ruoli r on r.id=u.ruolo_id where u.id=p_admin and u.attivo and r.amministratore_workspace) then raise exception 'ADMIN_REQUIRED'; end if;
 insert into ai_development_permissions(user_id,develop,publish,browser,database,updated_by)
 values(p_user,(p_permissions->>'develop')::boolean,(p_permissions->>'publish')::boolean,(p_permissions->>'browser')::boolean,(p_permissions->>'database')::boolean,p_admin)
 on conflict(user_id) do update set develop=excluded.develop,publish=excluded.publish,browser=excluded.browser,database=excluded.database,updated_by=p_admin,updated_at=now();
 insert into ai_audit_log(utente_id,azione,entita_tipo,entita_id,dettagli) values(p_admin,'development_permissions_changed','utente',p_user,p_permissions);
end $$;
-- Update only the named, existing worker guards; fail if their contract has drifted.
do $$
declare signature text; definition text; old_guard text; new_guard text;
begin
 foreach signature in array array['cancel_ai_development_job(uuid,uuid)','begin_ai_development_publication(uuid,uuid,uuid)','claim_ai_development_job(uuid)','reserve_ai_development_generation(uuid,uuid,uuid,text)'] loop
  definition:=pg_get_functiondef(('public.'||signature)::regprocedure);
  old_guard:='and u.attivo and r.amministratore_workspace';
  if position(old_guard in definition)=0 then raise exception 'DEVELOPMENT_GUARD_CHANGED: %',signature; end if;
  new_guard:='and u.attivo and public.ai_development_allowed(u.id,''develop'')';
  if signature not like 'cancel_%' then new_guard:=new_guard||' and (not j.publish_requested or public.ai_development_allowed(u.id,''publish''))'; end if;
  execute replace(definition,old_guard,new_guard);
 end loop;
end $$;
create table public.ai_runtime_operations (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references utenti(id),
 conversation_id uuid references ai_conversazioni(id),
 capability text not null check(capability in ('browser','database')),
 payload jsonb not null, status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled','interrupted')),
 host_id uuid references ai_development_hosts(id), lease_token uuid, lease_until timestamptz,
 result jsonb, error text, created_at timestamptz not null default now(), finished_at timestamptz
);
alter table public.ai_runtime_operations enable row level security;
revoke all on public.ai_runtime_operations from anon,authenticated;
grant all on public.ai_runtime_operations to service_role;
create function public.claim_ai_runtime_operation(p_host uuid)
returns setof public.ai_runtime_operations language plpgsql security definer set search_path=public as $$
declare selected_id uuid;
begin
 if not exists(select 1 from ai_development_hosts where id=p_host and active) then raise exception 'HOST_DISABLED'; end if;
 update ai_runtime_operations set status='interrupted',error='Sessione scaduta: verificare l’esito prima di ripetere.',finished_at=now() where status='running' and lease_until<now();
 select id into selected_id from ai_runtime_operations o where status='queued' and ai_development_allowed(o.user_id,o.capability) order by created_at for update skip locked limit 1;
 return query update ai_runtime_operations set status='running',host_id=p_host,lease_token=gen_random_uuid(),lease_until=now()+interval '4 minutes' where id=selected_id returning *;
end $$;
revoke all on function public.ai_development_allowed(uuid,text),public.set_ai_development_permissions(uuid,uuid,jsonb),public.claim_ai_runtime_operation(uuid) from public,anon,authenticated;
grant execute on function public.ai_development_allowed(uuid,text),public.set_ai_development_permissions(uuid,uuid,jsonb),public.claim_ai_runtime_operation(uuid) to service_role;
commit;

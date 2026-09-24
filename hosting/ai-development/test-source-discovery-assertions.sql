insert into ai_development_hosts(id,name,token_hash,created_by)
values('40000000-0000-4000-8000-000000000002','discovery',repeat('b',64),workspace_current_profile_id());
insert into ai_development_jobs(id,user_id,repository,instruction,status,host_id,lease_token,lease_until)
values('50000000-0000-4000-8000-000000000002',workspace_current_profile_id(),'workspace','Test source discovery budget','running',
 '40000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002',now()+interval '5 minutes');
do $$ declare used integer; i integer; begin
 for i in 1..24 loop
  select generation_count into used from reserve_ai_development_generation('50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002',repeat('a',40));
  if used is distinct from i then raise exception 'DISCOVERY_BUDGET_NOT_RESERVED_%',i; end if;
 end loop;
 if exists(select 1 from reserve_ai_development_generation('50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002',repeat('a',40))) then raise exception 'UNBOUNDED_GENERATION'; end if;
 update ai_development_jobs set generation_count=1 where id='50000000-0000-4000-8000-000000000002';
 if exists(select 1 from reserve_ai_development_generation('50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002',repeat('b',40))) then raise exception 'REVISION_CHANGED'; end if;
 if exists(select 1 from reserve_ai_development_generation('50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000003',repeat('a',40))) then raise exception 'WRONG_LEASE_ACCEPTED'; end if;
 update utenti set attivo=false where id=workspace_current_profile_id();
 if exists(select 1 from reserve_ai_development_generation('50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002',repeat('a',40))) then raise exception 'REVOKED_OWNER_ACCEPTED'; end if;
 update utenti set attivo=true where id=workspace_current_profile_id();
 update ai_development_hosts set active=false where id='40000000-0000-4000-8000-000000000002';
 if exists(select 1 from reserve_ai_development_generation('50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002',repeat('a',40))) then raise exception 'REVOKED_HOST_ACCEPTED'; end if;
 update ai_development_hosts set active=true where id='40000000-0000-4000-8000-000000000002';
 update ai_development_jobs set lease_until=now()-interval '1 minute' where id='50000000-0000-4000-8000-000000000002';
 if exists(select 1 from reserve_ai_development_generation('50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002',repeat('a',40))) then raise exception 'EXPIRED_LEASE_ACCEPTED'; end if;
end $$;

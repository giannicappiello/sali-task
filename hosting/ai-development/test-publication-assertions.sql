insert into ai_conversazioni(id,utente_id) values('30000000-0000-4000-8000-000000000001',workspace_current_profile_id());
insert into ai_development_hosts(id,name,token_hash,created_by) values('40000000-0000-4000-8000-000000000001','test',repeat('a',64),workspace_current_profile_id());
insert into ai_development_jobs(id,user_id,conversation_id,repository,instruction,status,publish_requested,result)
values('50000000-0000-4000-8000-000000000001',workspace_current_profile_id(),'30000000-0000-4000-8000-000000000001','mes','Pubblicazione test isolato','running',true,jsonb_build_object('revision',jsonb_build_object('commit',repeat('b',40))));
update ai_development_jobs set status='published' where id='50000000-0000-4000-8000-000000000001';
do $$ begin
 if not exists(select 1 from ai_messaggi where id='50000000-0000-4000-8000-000000000001' and contenuto like '%aggiorna MES%') then raise exception 'MISSING_NOTIFICATION'; end if;
end $$;
update ai_development_jobs set status='running',lease_until=now()-interval '1 minute' where id='50000000-0000-4000-8000-000000000001';
select count(*) from claim_ai_development_job('40000000-0000-4000-8000-000000000001');
do $$ begin
 if not exists(select 1 from ai_development_jobs where id='50000000-0000-4000-8000-000000000001' and status='running' and lease_until>now()) then raise exception 'NOT_RESUMED'; end if;
end $$;
update ai_development_jobs set status='published' where id='50000000-0000-4000-8000-000000000001';
do $$ begin
 if (select count(*) from ai_messaggi)<>1 then raise exception 'DUPLICATE_NOTIFICATION'; end if;
end $$;

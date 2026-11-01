-- Append inside the migration trial transaction. Every fixture is rolled back.
create temporary table brain_test_users as
 select u.id,u.auth_user_id,row_number() over(order by u.id) as n
 from public.utenti u join public.ruoli r on r.id=u.ruolo_id
 where u.attivo and r.amministratore_workspace and u.auth_user_id is not null;
grant select on brain_test_users to authenticated;
do $$ begin if (select count(*) from brain_test_users)<2 then raise exception 'Need two authorized test identities'; end if; end $$;
insert into public.second_brain_memory(owner_id,scope,title,content,kind,source,source_key)
 select id,'personal','RLS fixture','temporary fixture','historical','regression','regression:'||id::text from brain_test_users where n<=2;
select set_config('request.jwt.claim.sub',(select auth_user_id::text from brain_test_users where n=1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_user_id from brain_test_users where n=1),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare v_count integer; v_id uuid; v_result public.second_brain_proposals; begin
 select count(*) into v_count from public.second_brain_memory where source='regression';
 if v_count<>1 then raise exception 'Private memory isolation failed: %',v_count; end if;
 select (public.second_brain_propose('MEMORY_SAVE',jsonb_build_object('scope','personal','title','Regression decision','content','temporary','kind','decision','source','regression','sourceKey','regression:save'))).id into v_id;
 select * into v_result from public.second_brain_decide(v_id,true);
 if v_result.status<>'executed' then raise exception 'Memory confirm failed'; end if;
 select * into v_result from public.second_brain_decide(v_id,true);
 if v_result.status<>'executed' then raise exception 'Idempotent readback failed'; end if;
 if (select count(*) from public.second_brain_memory where source_key='regression:save')<>1 then raise exception 'Duplicate memory'; end if;
 perform public.second_brain_import_history('[{"scope":"personal","kind":"historical","title":"Imported fixture","content":"temporary","source":"regression","sourceKey":"regression:import"}]'::jsonb);
 perform public.second_brain_import_history('[{"scope":"personal","kind":"historical","title":"Imported fixture","content":"temporary","source":"regression","sourceKey":"regression:import"}]'::jsonb);
 if (select count(*) from public.second_brain_memory where source_key='regression:import')<>1 then raise exception 'Import duplicates'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select auth_user_id::text from brain_test_users where n=2),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_user_id from brain_test_users where n=2),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.second_brain_memory where source='regression')<>1 then raise exception 'Other user can see private memory'; end if;
 if exists(select 1 from public.second_brain_proposals) then raise exception 'Other user can see proposals'; end if;
end $$;
reset role;
select 'second-brain RLS, ownership, confirmation, idempotency: passed' as regression;

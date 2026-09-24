insert into prodotti values('30000000-0000-4000-8000-000000000001','Originale',null,true);
insert into ai_action_audit(id,user_id,system,tool,status,payload_summary)
select '40000000-0000-4000-8000-000000000001',workspace_current_profile_id(),'workspace','ARTICLE_BULK_UPDATE','proposed',jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',id,'before',to_jsonb(p),'changes',jsonb_build_object('nome','Corretto')))) from prodotti p;
select decide_workspace_ai_action('40000000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select nome from prodotti limit 1)<>'Corretto' then raise exception 'Product update failed'; end if;
 if (select status from ai_action_audit limit 1)<>'executed' then raise exception 'Audit missing'; end if;
end $$;
-- Replay must not repeat or overwrite a subsequent operator edit.
update prodotti set nome='Modifica operatore';
select decide_workspace_ai_action('40000000-0000-4000-8000-000000000001',true);
do $$ begin if (select nome from prodotti limit 1)<>'Modifica operatore' then raise exception 'Replay overwrote operator'; end if; end $$;
insert into ai_action_audit select '40000000-0000-4000-8000-000000000002',user_id,system,tool,'proposed',payload_summary,null,null,null,null from ai_action_audit limit 1;
do $$ begin
 begin perform decide_workspace_ai_action('40000000-0000-4000-8000-000000000002',true); raise exception 'Expected stale rejection';
 exception when others then if sqlerrm<>'PRODUCT_CHANGED_REGENERATE_PREVIEW' then raise; end if; end;
 if (select status from ai_action_audit where id='40000000-0000-4000-8000-000000000002')<>'proposed' then raise exception 'Failure changed audit'; end if;
end $$;
set test.confirm='false';
do $$ begin
 begin perform decide_workspace_ai_action('40000000-0000-4000-8000-000000000002',true); raise exception 'Expected permission rejection';
 exception when others then if sqlerrm<>'FORBIDDEN' then raise; end if; end;
end $$;
-- Queue leases bind a job to one active host and the original commit.
insert into ai_development_hosts(id,name,token_hash,created_by) values('50000000-0000-4000-8000-000000000001','Fixture',repeat('a',64),workspace_current_profile_id());
insert into ai_development_jobs(id,user_id,repository,instruction,status) values('60000000-0000-4000-8000-000000000001',workspace_current_profile_id(),'workspace','Correzione di prova','queued');
select id,status from claim_ai_development_job('50000000-0000-4000-8000-000000000001');
do $$ declare j ai_development_jobs; n integer; begin
 select * into j from ai_development_jobs limit 1;
 if j.status<>'running' or j.lease_token is null then raise exception 'Claim failed'; end if;
 select count(*) into n from claim_ai_development_job('50000000-0000-4000-8000-000000000001');
 if n<>0 then raise exception 'Double claim'; end if;
 select count(*) into n from reserve_ai_development_generation(j.id,j.host_id,j.lease_token,repeat('a',40));
 if n<>1 then raise exception 'Generation reservation failed'; end if;
 select count(*) into n from reserve_ai_development_generation(j.id,j.host_id,j.lease_token,repeat('b',40));
 if n<>0 then raise exception 'Accepted another base revision'; end if;
 update utenti set attivo=false;
 select count(*) into n from reserve_ai_development_generation(j.id,j.host_id,j.lease_token,repeat('a',40));
 if n<>0 then raise exception 'Accepted revoked owner'; end if;
end $$;
select 'AI database assertions passed' as result;

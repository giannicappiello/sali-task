-- Run inside a transaction and roll it back: no operational records are changed.
do $$
declare actor uuid; other_actor uuid; c uuid; r uuid:=gen_random_uuid(); l uuid:=gen_random_uuid();
 x jsonb; n integer; request jsonb:='{"prompt":"Test tecnico Codex","displayedPrompt":"Test tecnico Codex","mode":"interno","attachments":[]}';
begin
 select id into actor from utenti where attivo limit 1;
 select id into other_actor from utenti where id<>actor limit 1;
 if actor is null or other_actor is null then raise exception 'TEST_USERS_REQUIRED'; end if;
 insert into ai_conversazioni(utente_id,titolo,modalita) values(actor,'TEST rollback Codex','interno') returning id into c;
 x:=start_workspace_codex_run(actor,c,r,request);
 perform start_workspace_codex_run(actor,c,r,request);
 select count(*) into n from ai_messaggi where conversazione_id=c;
 if n<>1 then raise exception 'DUPLICATE_USER_MESSAGE'; end if;
 begin
  perform start_workspace_codex_run(other_actor,c,gen_random_uuid(),request);
  raise exception 'OWNER_BYPASS';
 exception when raise_exception then if sqlerrm<>'CONVERSATION_NOT_FOUND' then raise; end if; end;
 begin
  perform start_workspace_codex_run(actor,c,gen_random_uuid(),request);
  raise exception 'CONCURRENT_RUN';
 exception when raise_exception then if sqlerrm<>'CODEX_ALREADY_RUNNING' then raise; end if; end;
 if claim_workspace_codex_run(other_actor,r,l) is not null then raise exception 'LEASE_OWNER_BYPASS'; end if;
 x:=claim_workspace_codex_run(actor,r,l);
 if x is null then raise exception 'LEASE_MISSING'; end if;
 if claim_workspace_codex_run(actor,r,gen_random_uuid()) is not null then raise exception 'DOUBLE_LEASE'; end if;
 begin
  perform finish_workspace_codex_run(actor,r,gen_random_uuid(),'{"answer":"Test"}','{}','{}');
  raise exception 'FINALIZE_WITHOUT_LEASE';
 exception when raise_exception then if sqlerrm<>'CODEX_LEASE_LOST' then raise; end if; end;
 perform finish_workspace_codex_run(actor,r,l,'{"answer":"Test verificato","sources":[]}','{"model":"test","runtime":"codex-agents"}','{"input":10,"output":2,"available":true}');
 perform finish_workspace_codex_run(actor,r,l,'{"answer":"Test duplicato","sources":[]}','{"model":"test"}','{"input":10,"output":2}');
 select count(*) into n from ai_messaggi where conversazione_id=c;
 if n<>2 then raise exception 'FINALIZE_NOT_IDEMPOTENT'; end if;
 if has_table_privilege('authenticated','public.ai_codex_calls','SELECT') then raise exception 'CALL_LEDGER_EXPOSED'; end if;
 if has_function_privilege('authenticated','public.start_workspace_codex_run(uuid,uuid,uuid,jsonb)','EXECUTE') then raise exception 'RUN_RPC_EXPOSED'; end if;
end $$;
select 'codex_session_regression_passed' as result;

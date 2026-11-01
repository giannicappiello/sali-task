-- Explicitly requested retirement of the previous application's chats.
-- Business records, action audit, access rules and AI-order acquisition stay intact.
lock table public.ai_conversazioni in access exclusive mode;
insert into public.ai_audit_log(utente_id,azione,entita_tipo,dettagli)
select '35cc0e58-9bad-48a4-9980-0904dd63fc7b'::uuid,'legacy_assistant_retired','second_brain',
 jsonb_build_object('conversations',(select count(*) from public.ai_conversazioni),
 'messages',(select count(*) from public.ai_messaggi),'topics',(select count(*) from public.ai_argomenti));
delete from public.ai_runtime_operations where conversation_id is not null;
delete from public.ai_development_jobs;
delete from public.ai_conversazioni;
delete from public.ai_argomenti;

create or replace function public.reject_retired_assistant_chat()
returns trigger language plpgsql set search_path=public as $$
begin
 raise exception 'Il precedente assistente e stato rimosso. Usare Second Brain Progre.' using errcode='55000';
end;
$$;
revoke all on function public.reject_retired_assistant_chat() from public,anon,authenticated;
drop trigger if exists retired_assistant_chat on public.ai_conversazioni;
create trigger retired_assistant_chat before insert or update on public.ai_conversazioni
for each row execute function public.reject_retired_assistant_chat();
drop trigger if exists retired_assistant_message on public.ai_messaggi;
create trigger retired_assistant_message before insert or update on public.ai_messaggi
for each row execute function public.reject_retired_assistant_chat();
drop trigger if exists retired_assistant_topic on public.ai_argomenti;
create trigger retired_assistant_topic before insert or update on public.ai_argomenti
for each row execute function public.reject_retired_assistant_chat();

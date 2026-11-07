-- Define capabilities only. No user or role receives a new permission here.
begin;
insert into public.permessi(codice,descrizione,modulo) values
 ('progremes.production.force_close','Autorizza chiusura forzata','progremes'),
 ('progremes.production.force_start','Autorizza avvio forzato','progremes'),
 ('progremes.production.reopen','Autorizza riapertura lavorazione','progremes')
on conflict(codice) do nothing;

create or replace function public.workspace_mes_production_permissions()
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(p.codice order by p.codice),'[]'::jsonb)
 from public.permessi p join public.permessi_utente pu on pu.permesso_id=p.id
 join public.utenti u on u.id=pu.utente_id
 where u.auth_user_id=auth.uid() and u.attivo is not false
 and p.codice in ('progremes.production.force_close','progremes.production.force_start','progremes.production.reopen')
$$;
revoke all on function public.workspace_mes_production_permissions() from public,anon;
grant execute on function public.workspace_mes_production_permissions() to authenticated;

-- Applies even to direct RPC calls and Workspace administrators. The existing
-- RPCs still enforce AI level, module scope, owner and separate confirmation.
create or replace function public.workspace_guard_production_emergency()
returns trigger language plpgsql security definer set search_path=public as $$
declare required_code text;
begin
 required_code:=case new.tool
  when 'MES_PRODUCTION_FORCE_CLOSE' then 'progremes.production.force_close'
  when 'MES_PRODUCTION_FORCE_START' then 'progremes.production.force_start'
  when 'MES_PRODUCTION_REOPEN' then 'progremes.production.reopen' else null end;
 if required_code is null then
  if new.tool='MES_PRODUCTION_START' and coalesce(new.payload_summary->>'allowShortage','false')='true'
    and new.status in ('proposed','confirmed') then
   raise exception 'USE_CONTROLLED_FORCE_START' using errcode='42501';
  end if;
  return new;
 end if;
 if tg_op='UPDATE' and (old.tool is distinct from new.tool or old.user_id is distinct from new.user_id
   or old.payload_summary is distinct from new.payload_summary) then
  raise exception 'IMMUTABLE_PRODUCTION_PROPOSAL';
 end if;
 if new.status in ('proposed','confirmed') and (tg_op='INSERT' or old.status is distinct from new.status) then
  if public.workspace_current_profile_id() is distinct from new.user_id then
   raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if not exists(select 1 from public.permessi_utente pu join public.permessi p on p.id=pu.permesso_id
   join public.utenti u on u.id=pu.utente_id where u.id=new.user_id and u.attivo is not false and p.codice=required_code) then
   raise exception 'SPECIFIC_PRODUCTION_PERMISSION_REQUIRED' using errcode='42501';
  end if;
  if coalesce(new.payload_summary->>'anomalyType','') not in ('meccanica','elettrica','dosaggio_peso','materiale','qualita','software','altro')
   or length(btrim(coalesce(new.payload_summary->>'anomalyDescription',''))) not between 5 and 1000
   or length(btrim(coalesce(new.payload_summary->>'reason',''))) not between 5 and 1000 then
   raise exception 'ANOMALY_AND_REASON_REQUIRED';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.workspace_guard_production_emergency() from public,anon,authenticated;
create trigger guard_production_emergency before insert or update on public.ai_action_audit
 for each row execute function public.workspace_guard_production_emergency();

insert into public.ai_action_registry(code,system,risk_level,input_schema,required_permission,active) values
 ('MES_PRODUCTION_FORCE_START','mes','destructive','{"type":"object","required":["targetId","phaseId","kind","expectedHash","anomalyType","anomalyDescription","reason"]}', 'progremes.production.force_start',true),
 ('MES_PRODUCTION_REOPEN','mes','destructive','{"type":"object","required":["targetId","expectedHash","anomalyType","anomalyDescription","reason"]}', 'progremes.production.reopen',true)
on conflict(code) do update set input_schema=excluded.input_schema,required_permission=excluded.required_permission,active=true,updated_at=now();
update public.ai_action_registry set required_permission='progremes.production.force_close',updated_at=now()
 where code='MES_PRODUCTION_FORCE_CLOSE';
notify pgrst,'reload schema';
commit;

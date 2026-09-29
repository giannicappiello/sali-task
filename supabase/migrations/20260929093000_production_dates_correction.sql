begin;
insert into public.ai_action_registry(code,system,risk_level,input_schema,required_permission,active)
values ('MES_PRODUCTION_DATES_CORRECT','mes','write','{"type":"object","required":["targetId","expectedHash","reason","alignBoundaryPresences"]}'::jsonb,'progremes.write',true)
on conflict(code) do update set system=excluded.system,risk_level=excluded.risk_level,input_schema=excluded.input_schema,required_permission=excluded.required_permission,active=excluded.active;
commit;

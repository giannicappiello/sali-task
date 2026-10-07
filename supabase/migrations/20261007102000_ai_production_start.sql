-- Register the existing MES print/start workflow. No production data is changed.
insert into public.ai_action_registry(code,system,risk_level,input_schema,required_permission,active)
values ('MES_PRODUCTION_START','mes','write',
 '{"type":"object","required":["targetId","kind","phaseId","expectedHash"]}'::jsonb,
 'progremes.write',true)
on conflict(code) do update set system=excluded.system,risk_level=excluded.risk_level,
 input_schema=excluded.input_schema,required_permission=excluded.required_permission,active=excluded.active;


-- Resume frozen MES closure through its durable document journal. No production rows changed.
insert into public.ai_action_registry(code,system,risk_level,input_schema,required_permission,active)
values ('MES_PRODUCTION_RESUME_CLOSE','mes','write',
 '{"type":"object","required":["targetId","expectedHash"]}'::jsonb,'progremes.write',true)
on conflict(code) do update set system=excluded.system,risk_level=excluded.risk_level,
 input_schema=excluded.input_schema,required_permission=excluded.required_permission,active=excluded.active;

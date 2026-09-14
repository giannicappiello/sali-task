-- Registers a confirmation-only tool. Does not reallocate or start any production.
insert into public.ai_action_registry(code,system,risk_level,input_schema,required_permission,active)
values ('MES_MATERIAL_REALLOCATE','mes','destructive',
  '{"type":"object","required":["targetId","orderNumber","articleCode","expectedHash","transfers","reason","evidence"]}'::jsonb,
  'progremes.write',true)
on conflict(code) do update set system=excluded.system,risk_level=excluded.risk_level,
  input_schema=excluded.input_schema,required_permission=excluded.required_permission,active=excluded.active;

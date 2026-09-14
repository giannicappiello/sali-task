-- Controlled action only: this migration does not close any production.
insert into public.ai_action_registry(code,system,risk_level,input_schema,required_permission,active)
values ('MES_PRODUCTION_FORCE_CLOSE','mes','destructive',
  '{"type":"object","required":["productionId","productionOrderId","orderNumber","articleCode","reason","slAndClAlreadyRegistered"]}'::jsonb,
  'progremes.write',true)
on conflict(code) do update set system=excluded.system,risk_level=excluded.risk_level,
  input_schema=excluded.input_schema,required_permission=excluded.required_permission,active=excluded.active;

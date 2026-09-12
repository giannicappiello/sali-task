begin;

insert into public.ai_action_registry(code,system,risk_level,input_schema,required_permission,active)
values('MES_UI_CONFIGURE_VIEW','mes','write','{"type":"object"}'::jsonb,'progremes.write',true)
on conflict(code) do update set
  system=excluded.system,
  risk_level=excluded.risk_level,
  required_permission=excluded.required_permission,
  active=true,
  updated_at=now();

commit;

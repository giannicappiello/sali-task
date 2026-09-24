begin;
insert into public.ai_action_registry(code,system,risk_level,input_schema,required_permission,active)
values('MES_RESOURCE_COST_UPDATE','mes','write','{"type":"object"}'::jsonb,'progremes.write',true),
('ARTICLE_BULK_UPDATE','workspace','write','{"type":"object"}'::jsonb,'products.write',true),
('MACHINE_INSTRUCTION_DRAFT','mes','write','{"type":"object"}'::jsonb,'progremes.write',true)
on conflict(code) do update set active=true,input_schema=excluded.input_schema;
-- Legacy entries without an executor must not accept or confirm new actions.
update public.ai_action_registry set active=false where code in
('PLANNING_CRITERIA_UPDATE','RDP_UPDATE','OP_UPDATE','LOT_DOCUMENT_LINK','PURCHASE_PROPOSAL_CREATE','MONITOR_RULE_CREATE');
commit;

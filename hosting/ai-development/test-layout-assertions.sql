-- Disposable fixture: stale layout proposals must never overwrite later work.
create function workspace_validate_builder_layout(jsonb) returns void language sql as $$select$$;
create table workspace_builder_scoped_layouts(id uuid primary key default gen_random_uuid(),target_type text,target_code text,scope_type text,scope_id uuid,layout jsonb,current_version int default 1,updated_by uuid,updated_at timestamptz);
create table workspace_builder_scoped_versions(layout_id uuid,version int,layout jsonb,created_by uuid);
insert into ai_action_registry(code,system,active) values('UI_CONFIGURE_VIEW','workspace',true),('ACCESS_ROLE_UPDATE','workspace',true);
insert into workspace_builder_scoped_layouts(id,target_type,target_code,scope_type,layout,current_version) values('70000000-0000-4000-8000-000000000001','screen','test','global','{}',3);
insert into ai_action_audit(id,user_id,system,tool,status,payload_summary) values('70000000-0000-4000-8000-000000000002',workspace_current_profile_id(),'workspace','UI_CONFIGURE_VIEW','proposed','{"targetType":"screen","targetCode":"test","scopeType":"global","layout":{},"expectedVersion":2}');
set test.admin='true'; set test.confirm='true';
do $$begin
  begin perform decide_workspace_ai_action('70000000-0000-4000-8000-000000000002',true); raise exception 'Stale layout accepted';
  exception when others then if sqlerrm <> 'LAYOUT_CHANGED_REGENERATE_PREVIEW' then raise; end if; end;
  if (select current_version from workspace_builder_scoped_layouts limit 1)<>3 then raise exception 'Existing layout changed'; end if;
end$$;
update ai_action_audit set payload_summary=jsonb_set(payload_summary,'{expectedVersion}','3') where id='70000000-0000-4000-8000-000000000002';
do $$begin
  perform decide_workspace_ai_action('70000000-0000-4000-8000-000000000002',true);
  if (select current_version from workspace_builder_scoped_layouts limit 1)<>4 then raise exception 'Valid layout not applied'; end if;
end$$;

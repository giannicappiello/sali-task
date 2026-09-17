begin;

-- Remove the explanatory card from every configured screen/scope.
-- This changes presentation only; planning/material availability rules are unchanged.
-- Keep the previous layout and a new revision so this removal is reversible.
do $$
declare
  item record;
  cleaned jsonb;
  next_version integer;
begin
  for item in select * from public.workspace_builder_scoped_layouts
    where exists (select 1 from jsonb_array_elements(layout->'blocks') b
      where b->>'id' = 'notice-producibilita-materiali'
         or lower(trim(b->>'title')) = 'regola producibilità')
    for update
  loop
    select coalesce(jsonb_agg(b order by position), '[]'::jsonb) into cleaned
      from jsonb_array_elements(item.layout->'blocks') with ordinality as blocks(b, position)
      where coalesce(b->>'id', '') <> 'notice-producibilita-materiali'
        and lower(trim(coalesce(b->>'title', ''))) <> 'regola producibilità';
    insert into public.workspace_builder_scoped_versions(layout_id,version,layout,created_by)
      values(item.id,item.current_version,item.layout,item.updated_by)
      on conflict(layout_id,version) do nothing;
    select greatest(item.current_version,coalesce(max(version),0))+1 into next_version
      from public.workspace_builder_scoped_versions where layout_id=item.id;
    cleaned := jsonb_set(item.layout, '{blocks}', cleaned);
    update public.workspace_builder_scoped_layouts set layout=cleaned,current_version=next_version,
      updated_by=null,updated_at=now() where id=item.id;
    insert into public.workspace_builder_scoped_versions(layout_id,version,layout)
      values(item.id,next_version,cleaned);
    insert into public.workspace_builder_audit_log(target_type,target_code,action,details)
      values(item.target_type,item.target_code,'remove_producibility_explanation_card',
        jsonb_build_object('layout_id',item.id,'scope_type',item.scope_type,'scope_id',item.scope_id,
          'previous_version',item.current_version,'version',next_version));
  end loop;

  for item in select * from public.workspace_builder_layouts
    where exists (select 1 from jsonb_array_elements(layout->'blocks') b
      where b->>'id' = 'notice-producibilita-materiali'
         or lower(trim(b->>'title')) = 'regola producibilità')
    for update
  loop
    select coalesce(jsonb_agg(b order by position), '[]'::jsonb) into cleaned
      from jsonb_array_elements(item.layout->'blocks') with ordinality as blocks(b, position)
      where coalesce(b->>'id', '') <> 'notice-producibilita-materiali'
        and lower(trim(coalesce(b->>'title', ''))) <> 'regola producibilità';
    insert into public.workspace_builder_versions(target_type,target_code,version,layout,created_by)
      values(item.target_type,item.target_code,item.current_version,item.layout,item.updated_by)
      on conflict(target_type,target_code,version) do nothing;
    select greatest(item.current_version,coalesce(max(version),0))+1 into next_version
      from public.workspace_builder_versions where target_type=item.target_type and target_code=item.target_code;
    cleaned := jsonb_set(item.layout, '{blocks}', cleaned);
    update public.workspace_builder_layouts set layout=cleaned,current_version=next_version,
      updated_by=null,updated_at=now() where target_type=item.target_type and target_code=item.target_code;
    insert into public.workspace_builder_versions(target_type,target_code,version,layout)
      values(item.target_type,item.target_code,next_version,cleaned);
    insert into public.workspace_builder_audit_log(target_type,target_code,action,details)
      values(item.target_type,item.target_code,'remove_producibility_explanation_card',
        jsonb_build_object('previous_version',item.current_version,'version',next_version));
  end loop;
end $$;

commit;

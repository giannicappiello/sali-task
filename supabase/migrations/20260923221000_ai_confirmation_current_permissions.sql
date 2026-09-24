-- A saved proposal is not an authorization grant. Check again on confirmation.
-- Validation errors roll back; they must never update an unrelated audit row.
begin;

create or replace function public.decide_workspace_ai_action(p_proposal_id uuid,p_confirm boolean)
returns public.ai_action_audit language plpgsql security definer set search_path=public as $$
declare v_user uuid:=public.workspace_current_profile_id(); v_action public.ai_action_audit; v_layout_id uuid; v_version integer; v_changes jsonb; v_target uuid; v_item jsonb; v_items jsonb; v_before jsonb;
begin
  if v_user is null or p_confirm is null then raise exception 'FORBIDDEN'; end if;
  select * into v_action from public.ai_action_audit where id=p_proposal_id and user_id=v_user for update;
  if v_action.id is null then raise exception 'NOT_FOUND'; end if;
  if p_confirm then
    if not public.workspace_ai_can_confirm() then raise exception 'FORBIDDEN'; end if;
    if not exists(select 1 from public.ai_action_registry where code=v_action.tool and active) then raise exception 'TOOL_NOT_ALLOWED'; end if;
    if v_action.system='mes' and not public.company_mes_ai_can_write() then raise exception 'FORBIDDEN'; end if;
    if not public.workspace_user_is_admin() then
      if v_action.tool='ACCESS_ROLE_UPDATE' then raise exception 'FORBIDDEN'; end if;
      if v_action.tool in ('ARTICLE_UPDATE','ARTICLE_BULK_UPDATE') and coalesce(public.workspace_access_context()->'module_levels'->>'prodotti','nessuno') not in ('scrittura','amministrazione') then raise exception 'FORBIDDEN'; end if;
      if v_action.tool='DOCUMENT_METADATA_UPDATE' and coalesce(public.workspace_access_context()->'module_levels'->>'documenti','nessuno') not in ('scrittura','amministrazione') then raise exception 'FORBIDDEN'; end if;
      if v_action.tool in ('ARTICLE_UPDATE','ARTICLE_BULK_UPDATE') and not coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]'::jsonb) ? 'prodotti' then raise exception 'FORBIDDEN'; end if;
      if v_action.tool='DOCUMENT_METADATA_UPDATE' and not coalesce(public.workspace_ai_capabilities()->'allowed_modules','[]'::jsonb) ? 'documenti' then raise exception 'FORBIDDEN'; end if;
      if v_action.tool='UI_CONFIGURE_VIEW' and (
        coalesce(v_action.payload_summary->>'scopeType','')<>'user' or
        nullif(v_action.payload_summary->>'scopeId','')::uuid is distinct from v_user
      ) then raise exception 'FORBIDDEN'; end if;
    end if;
  end if;
  if v_action.status in ('executed','failed','rejected','rolled_back') then return v_action; end if;
  if v_action.status<>'proposed' then raise exception 'INVALID_STATE'; end if;
  if not p_confirm then update public.ai_action_audit set status='rejected',result='{"changed":false}'::jsonb where id=v_action.id returning * into v_action; return v_action; end if;
  update public.ai_action_audit set status='confirmed',confirmed_at=now() where id=v_action.id;
  if v_action.system='mes' then select * into v_action from public.ai_action_audit where id=v_action.id; return v_action; end if;

  if v_action.tool='UI_CONFIGURE_VIEW' then
    perform public.workspace_validate_builder_layout(v_action.payload_summary->'layout');
    update public.ai_action_audit set before_snapshot=(select to_jsonb(l) from public.workspace_builder_scoped_layouts l where l.target_type=v_action.payload_summary->>'targetType' and l.target_code=v_action.payload_summary->>'targetCode' and l.scope_type=v_action.payload_summary->>'scopeType' and l.scope_id is not distinct from nullif(v_action.payload_summary->>'scopeId','')::uuid) where id=v_action.id;
    select id,current_version into v_layout_id,v_version from public.workspace_builder_scoped_layouts where target_type=v_action.payload_summary->>'targetType' and target_code=v_action.payload_summary->>'targetCode' and scope_type=v_action.payload_summary->>'scopeType' and scope_id is not distinct from nullif(v_action.payload_summary->>'scopeId','')::uuid for update;
    if coalesce(v_version,0) is distinct from (v_action.payload_summary->>'expectedVersion')::integer then raise exception 'LAYOUT_CHANGED_REGENERATE_PREVIEW'; end if;
    if v_layout_id is null then
      insert into public.workspace_builder_scoped_layouts(target_type,target_code,scope_type,scope_id,layout,updated_by)
      values(v_action.payload_summary->>'targetType',v_action.payload_summary->>'targetCode',v_action.payload_summary->>'scopeType',nullif(v_action.payload_summary->>'scopeId','')::uuid,v_action.payload_summary->'layout',v_user)
      returning id,current_version into v_layout_id,v_version;
    else
      update public.workspace_builder_scoped_layouts set layout=v_action.payload_summary->'layout',current_version=current_version+1,updated_by=v_user,updated_at=now() where id=v_layout_id returning current_version into v_version;
    end if;
    insert into public.workspace_builder_scoped_versions(layout_id,version,layout,created_by) values(v_layout_id,v_version,v_action.payload_summary->'layout',v_user);
  elsif v_action.tool='MONITOR_RULE_CREATE' then
    insert into public.workspace_ai_monitor_rules(user_id,name,dataset,condition,frequency_minutes,notification_mode,active)
    values(v_user,v_action.payload_summary->>'name',v_action.payload_summary->>'dataset',v_action.payload_summary->'condition',(v_action.payload_summary->>'frequencyMinutes')::integer,coalesce(v_action.payload_summary->>'notificationMode','on_change'),coalesce((v_action.payload_summary->>'active')::boolean,true));
  elsif v_action.tool='ACCESS_ROLE_UPDATE' then
    if not public.workspace_user_is_admin() then raise exception 'FORBIDDEN'; end if; v_target:=(v_action.payload_summary->>'roleId')::uuid;
    perform 1 from public.ruoli where id=v_target for update;
    if not found then raise exception 'ROLE_NOT_FOUND'; end if;
    if exists(select 1 from public.ruoli where id=v_target and amministratore_workspace) then raise exception 'ADMIN_ROLE_PROTECTED'; end if;
    update public.ai_action_audit set before_snapshot=(select to_jsonb(r) from public.ruoli r where id=v_target) where id=v_action.id;
    update public.ruoli set ambito_dati=coalesce(v_action.payload_summary->>'dataScope',ambito_dati),livello_accesso=coalesce(v_action.payload_summary->>'accessLevel',livello_accesso),livello_ai=coalesce(v_action.payload_summary->>'aiLevel',livello_ai) where id=v_target;
    insert into public.ruoli_moduli(ruolo_id,modulo,livello_accesso) select v_target,x->>'module',x->>'level' from jsonb_array_elements(coalesce(v_action.payload_summary->'moduleLevels','[]'::jsonb))x on conflict(ruolo_id,modulo) do update set livello_accesso=excluded.livello_accesso;
  elsif v_action.tool in ('ARTICLE_UPDATE','ARTICLE_BULK_UPDATE') then
    v_items:=case when v_action.tool='ARTICLE_UPDATE' then jsonb_build_array(jsonb_build_object('id',v_action.payload_summary->>'targetId','changes',v_action.payload_summary->'changes','before',v_action.payload_summary->'before')) else v_action.payload_summary->'items' end;
    if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) not between 1 and 100 then raise exception 'INVALID_PRODUCTS'; end if;
    if (select count(distinct x->>'id') from jsonb_array_elements(v_items)x)<>jsonb_array_length(v_items) then raise exception 'DUPLICATE_PRODUCTS'; end if;
    update public.ai_action_audit set before_snapshot=(select jsonb_agg(x->'before') from jsonb_array_elements(v_items)x) where id=v_action.id;
    for v_item in select value from jsonb_array_elements(v_items) order by value->>'id' loop
      v_target:=(v_item->>'id')::uuid; v_changes:=v_item->'changes';
      if jsonb_typeof(v_changes) is distinct from 'object' or v_changes='{}'::jsonb then raise exception 'INVALID_CHANGES'; end if;
      if exists(select 1 from jsonb_object_keys(v_changes) as fields(name) where fields.name not in ('nome','descrizione','mostra_in_app')) then raise exception 'FIELD_NOT_ALLOWED'; end if;
      if v_changes?'nome' and (jsonb_typeof(v_changes->'nome')<>'string' or length(trim(v_changes->>'nome')) not between 1 and 500) then raise exception 'INVALID_NAME'; end if;
      if v_changes?'mostra_in_app' and jsonb_typeof(v_changes->'mostra_in_app')<>'boolean' then raise exception 'INVALID_VISIBILITY'; end if;
      if v_changes?'descrizione' and (jsonb_typeof(v_changes->'descrizione') not in ('string','null') or length(v_changes->>'descrizione')>10000) then raise exception 'INVALID_DESCRIPTION'; end if;
      select jsonb_build_object('id',id,'nome',nome,'descrizione',descrizione,'mostra_in_app',mostra_in_app) into v_before from public.prodotti where id=v_target for update;
      if v_before is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
      if v_before is distinct from v_item->'before' then raise exception 'PRODUCT_CHANGED_REGENERATE_PREVIEW'; end if;
      update public.prodotti set nome=case when v_changes?'nome' then v_changes->>'nome' else nome end,descrizione=case when v_changes?'descrizione' then v_changes->>'descrizione' else descrizione end,mostra_in_app=case when v_changes?'mostra_in_app' then (v_changes->>'mostra_in_app')::boolean else mostra_in_app end where id=v_target;
    end loop;
  elsif v_action.tool='DOCUMENT_METADATA_UPDATE' then
    v_target:=(v_action.payload_summary->>'targetId')::uuid; v_changes:=v_action.payload_summary->'changes';
    if jsonb_typeof(v_changes) is distinct from 'object' or v_changes='{}'::jsonb then raise exception 'INVALID_CHANGES'; end if;
    if exists(select 1 from jsonb_object_keys(v_changes) as allowed_key(key) where allowed_key.key not in ('titolo','categoria','marca','gamma','prodotto','parole_chiave','attivo')) then raise exception 'FIELD_NOT_ALLOWED'; end if;
    select jsonb_build_object('id',id,'titolo',titolo,'categoria',categoria,'marca',marca,'gamma',gamma,'prodotto',prodotto,'parole_chiave',parole_chiave,'attivo',attivo,'aggiornato_il',aggiornato_il) into v_before from public.documenti_workspace where id=v_target for update;
    if v_before is null then raise exception 'DOCUMENT_NOT_FOUND'; end if;
    if v_before is distinct from v_action.payload_summary->'before' then raise exception 'DOCUMENT_CHANGED_REGENERATE_PREVIEW'; end if;
    update public.ai_action_audit set before_snapshot=(select to_jsonb(d) from public.documenti_workspace d where id=v_target) where id=v_action.id;
    update public.documenti_workspace set titolo=case when v_changes?'titolo' then v_changes->>'titolo' else titolo end,categoria=case when v_changes?'categoria' then v_changes->>'categoria' else categoria end,marca=case when v_changes?'marca' then v_changes->>'marca' else marca end,gamma=case when v_changes?'gamma' then v_changes->>'gamma' else gamma end,prodotto=case when v_changes?'prodotto' then v_changes->>'prodotto' else prodotto end,parole_chiave=case when v_changes?'parole_chiave' then array(select jsonb_array_elements_text(v_changes->'parole_chiave')) else parole_chiave end,attivo=case when v_changes?'attivo' then (v_changes->>'attivo')::boolean else attivo end,aggiornato_il=now() where id=v_target;
  else raise exception 'WORKSPACE_TOOL_NOT_IMPLEMENTED'; end if;
  update public.ai_action_audit set status='executed',executed_at=now(),result=jsonb_build_object('changed',true,'tool',tool) where id=v_action.id returning * into v_action; return v_action;
end $$;

commit;

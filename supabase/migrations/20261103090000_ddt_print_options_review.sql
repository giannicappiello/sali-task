begin;

-- Empty by default: installing the feature does not activate the requested profile.
alter table public.warehouse_preparation_settings add column print_options jsonb not null default '{}'
 check(print_options in ('{}'::jsonb,'{"duplex":"long-edge","color":"monochrome","tray":"1"}'::jsonb));
alter table public.warehouse_print_jobs add column print_options jsonb not null default '{}'
 check(print_options in ('{}'::jsonb,'{"duplex":"long-edge","color":"monochrome","tray":"1"}'::jsonb));

create function public.warehouse_snapshot_print_options() returns trigger
 language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='UPDATE' then
  if new.print_options is distinct from old.print_options then raise exception 'Profilo stampa immutabile';end if;
  return new;
 end if;
 select print_options into new.print_options from public.warehouse_preparation_settings where id=true;
 if new.print_options<>'{}'::jsonb and
   (new.printer_id not like 'MES:%' or (new.document_kind<>'bcf_print' and new.document_kind !~ '^packing_pallet_[a-fA-F0-9-]{36}$')) then
  raise exception 'Duplex: usare DDT o packing list separata per bancale su stampante MES';
 end if;
 return new;
end;$$;
create trigger warehouse_print_options_snapshot before insert or update of print_options on public.warehouse_print_jobs
 for each row execute function public.warehouse_snapshot_print_options();
revoke all on function public.warehouse_snapshot_print_options() from public,anon,authenticated;

insert into public.ai_action_registry(code,system,risk_level,input_schema,required_permission,active)
 values('DDT_PRINT_SETTINGS_UPDATE','mes','write','{"type":"object","additionalProperties":false,"required":["reason"],"properties":{"reason":{"type":"string","minLength":5,"maxLength":500}}}',
 'integrations.configure',true)
 on conflict(code) do update set input_schema=excluded.input_schema,required_permission=excluded.required_permission,active=true,updated_at=now();

-- Called by the server only after the existing human decision has persisted `confirmed`.
-- Configuration, before/after audit and action result commit in one transaction.
create function public.warehouse_apply_print_settings_proposal(p_proposal uuid,p_actor uuid)
 returns public.ai_action_audit language plpgsql security definer set search_path=pg_catalog,public as $$
declare action public.ai_action_audit; before_settings public.warehouse_preparation_settings;
 after_settings public.warehouse_preparation_settings; options jsonb; printer text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'FORBIDDEN';end if;
 select * into action from public.ai_action_audit where id=p_proposal and user_id=p_actor for update;
 if action.id is null or action.tool<>'DDT_PRINT_SETTINGS_UPDATE' or action.system<>'mes' then raise exception 'NOT_FOUND';end if;
 if not exists(select 1 from public.utenti u join public.ruoli r on r.id=u.ruolo_id
   where u.id=p_actor and u.attivo is not false and r.amministratore_workspace is true)
   or public.workspace_screen_permission_for_user(p_actor,'integrations.configure','integrazioni.ddt') is distinct from true
   then raise exception 'FORBIDDEN';end if;
 if action.status='executed' then return action;end if;
 if action.status<>'confirmed' or action.confirmed_at is null then raise exception 'HUMAN_CONFIRMATION_REQUIRED';end if;
 if not exists(select 1 from public.ai_action_registry where code=action.tool and active) then raise exception 'TOOL_NOT_ALLOWED';end if;
 options:=action.payload_summary->'printOptions';printer:=action.payload_summary->>'printerId';
 if options is distinct from '{"duplex":"long-edge","color":"monochrome","tray":"1"}'::jsonb
  or length(btrim(coalesce(action.payload_summary->>'reason',''))) not between 5 and 500
  or printer is null or printer not like 'MES:%'
  or not exists(select 1 from public.warehouse_printers where id=printer and station='MES') then raise exception 'INVALID_PRINT_SETTINGS';end if;
 select * into strict before_settings from public.warehouse_preparation_settings where id=true for update;
 if before_settings.updated_at is distinct from (action.payload_summary->>'expectedUpdatedAt')::timestamptz
  then raise exception 'Configurazione cambiata: rigenerare la proposta' using errcode='40001';end if;
 update public.warehouse_preparation_settings set print_options=options,ddt_printer_id=printer,packing_printer_id=printer,
  updated_at=clock_timestamp() where id=true returning * into after_settings;
 insert into public.warehouse_dispatch_configuration_events(actor,before_settings,after_settings)
  values(p_actor,to_jsonb(before_settings),to_jsonb(after_settings));
 update public.ai_action_audit set status='executed',executed_at=now(),before_snapshot=to_jsonb(before_settings),
  result=jsonb_build_object('changed',true,'settings',to_jsonb(after_settings),'printed',false,'existingJobsChanged',false)
  where id=p_proposal returning * into action;
 return action;
end;$$;
revoke all on function public.warehouse_apply_print_settings_proposal(uuid,uuid) from public,anon,authenticated;
grant execute on function public.warehouse_apply_print_settings_proposal(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;

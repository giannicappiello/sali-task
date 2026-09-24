do $$begin
  if not (workspace_ai_capabilities()->'allowed_modules' ? 'human_resources') then raise exception 'Explicit HR grant missing'; end if;
  if workspace_ai_capabilities()->'allowed_modules' ? 'crm_b2b' then raise exception 'AI grant required'; end if;
  if workspace_ai_capabilities()->'allowed_modules' ? 'crm_online' then raise exception 'Business grant required'; end if;
end$$;
insert into ai_utenti_moduli values(workspace_current_profile_id(),'human_resources',false),(workspace_current_profile_id(),'crm_b2b',true);
do $$begin
  if workspace_ai_capabilities()->'allowed_modules' ? 'human_resources' then raise exception 'Individual denial ignored'; end if;
  if not (workspace_ai_capabilities()->'allowed_modules' ? 'crm_b2b') then raise exception 'Individual grant ignored'; end if;
end$$;

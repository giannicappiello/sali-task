begin;
set local lock_timeout = '3s';

-- Make the existing Messaggi module configurable by the existing AI permission
-- model. Preserve each installed function verbatim except for this one module
-- name. No role/user/department grants, new privileges or data policies.
do $migration$
declare
  target record;
  definition text;
  replacement text;
  old_count integer;
  new_count integer;
begin
  for target in select * from (values
    ('public.workspace_ai_capabilities()',
      '(''attivita'',''prodotti'',''documenti'',''beauty_days'',''ordini_pr'',''ordini_ph'',''progremes'',''ordini_private'',''human_resources'',''hr'',''crm_conto_terzi'',''crm_b2b'',''crm_online'')'),
    ('public.admin_ai_effective_access(uuid)',
      '(''attivita'',''prodotti'',''documenti'',''beauty_days'',''ordini_pr'',''ordini_ph'',''progremes'')')
  ) as expected(signature, module_list)
  loop
    definition := pg_get_functiondef(to_regprocedure(target.signature));
    if definition is null or position('module_base as (' in definition) = 0 then
      raise exception 'Missing or unexpected AI module function: %', target.signature;
    end if;
    replacement := left(target.module_list, length(target.module_list) - 1) || ',''messaggi'')';
    old_count := (length(definition) - length(replace(definition, target.module_list, ''))) / length(target.module_list);
    new_count := (length(definition) - length(replace(definition, replacement, ''))) / length(replacement);
    if old_count = 1 and new_count = 0 then
      execute replace(definition, target.module_list, replacement);
    elsif old_count = 0 and new_count = 1 then
      -- Reapplying the same migration does not change permissions or functions.
      null;
    else
      raise exception 'Unexpected AI module allowlist: %; review the installed definition', target.signature;
    end if;
  end loop;
end;
$migration$;

commit;

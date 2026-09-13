-- Run after the candidate migration inside a transaction; ALWAYS ROLLBACK.
-- The runner records the production director's original scope and visible codes
-- before installing the candidate. No test memberships or schema changes persist.
set local statement_timeout='25s';
set local role authenticated;
do $$
declare s jsonb; expected integer; actual integer;
begin
  s:=public.workspace_data_scope();
  if s->>'private_commercial_read'<>'true' or s->>'commercial_mode'='tutti' then
    raise exception 'PRIVATE read scope is missing or globally widened: %',s;
  end if;
  if s->'agent_ids' is distinct from (select scope->'agent_ids' from scope_baseline)
    or s->>'mode' is distinct from (select scope->>'mode' from scope_baseline) then
    raise exception 'Operational scope changed';
  end if;
  select count(*) into expected from expected_private;
  select count(*) into actual from public.visible_mexal_clients_for_me() c
    where c.codice_cliente in(select code from expected_private);
  if actual<>expected or expected=0 then raise exception 'PRIVATE directory incomplete: % / %',actual,expected; end if;
  if exists(select codice_cliente from public.visible_mexal_clients_for_me()
    except select code from expected_private union_check
    except select code from visible_before) then raise exception 'Unrelated customers newly exposed'; end if;
  if exists(select code from expected_private except select codice_cliente from public.ordini_clienti_cache) then
    raise exception 'Direct customer RLS still hides PRIVATE customers';
  end if;
  if exists(select id from expected_invoices except select id from public.mexal_fatture_vendita) then
    raise exception 'PRIVATE invoice RLS incomplete';
  end if;
  if exists(select id from expected_invoice_lines except select id from public.mexal_fatture_vendita_righe) then
    raise exception 'PRIVATE invoice line RLS incomplete';
  end if;
end $$;
reset role;

-- Replace the director's links only inside this rolled-back test transaction.
select set_config('request.jwt.claim.role','service_role',true);
select public.workspace_replace_user_customers(
  (select user_id from scope_baseline),(select array_agg(code) from selected_customers));
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
declare codes text[];
begin
  select array_agg(code order by code) into codes from selected_customers;
  if public.workspace_current_customer_codes() is distinct from codes then raise exception 'Multiple memberships not retained'; end if;
  if public.workspace_private_commercial_reader() or public.workspace_data_scope()->>'mode'<>'cliente' then
    raise exception 'Linked customer restriction bypassed';
  end if;
  if public.workspace_data_scope()->'customer_codes'<>to_jsonb(codes) then raise exception 'Session has stale single-customer scope'; end if;
  if (select count(*) from public.visible_mexal_clients_for_me())<>2 then raise exception 'Both customers must be visible'; end if;
  if (select count(*) from public.ordini_clienti_cache)<>2 then raise exception 'Customer RLS did not limit to two'; end if;
  if exists(select 1 from public.ordini_testate where not(codice_cliente=any(codes))) then raise exception 'Other customer orders exposed'; end if;
  if exists(select 1 from public.mexal_fatture_vendita where not(codice_cliente=any(codes))) then raise exception 'Other customer invoices exposed'; end if;
  begin
    perform public.workspace_replace_user_customers((select user_id from scope_baseline),array['unauthorized']);
    raise exception 'Non-admin changed memberships';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare before_codes text[];
begin
  before_codes:=public.workspace_current_customer_codes();
  begin
    perform public.workspace_replace_user_customers((select user_id from scope_baseline),array['NON-EXISTENT-TEST-CUSTOMER']);
    raise exception 'invalid membership accepted' using errcode='XX000';
  exception when raise_exception then null;
  end;
  if before_codes<>public.workspace_current_customer_codes() then raise exception 'Invalid save was not atomic'; end if;
end $$;
select public.workspace_replace_user_customers((select user_id from scope_baseline),
  array[(select code from selected_customers order by code limit 1)]);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.ordini_clienti_cache)<>1
    or jsonb_array_length(public.workspace_data_scope()->'customer_codes')<>1 then raise exception 'Removed customer retained access'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select public.workspace_replace_user_customers((select user_id from scope_baseline),'{}'::text[]);
select set_config('request.jwt.claim.role','authenticated',true);
delete from public.utenti_reparti where utente_id=(select user_id from scope_baseline)
  and reparto_id in(select department_id from public.workspace_private_commercial_read_rules);
do $$ begin
  if public.workspace_private_commercial_reader() then raise exception 'Removed department retained PRIVATE access'; end if;
end $$;
select 'PASS: PRIVATE scope, no DIRECT expansion, unchanged operational scope, multiple customers, RLS, atomic replacement and immediate revocation' as result;

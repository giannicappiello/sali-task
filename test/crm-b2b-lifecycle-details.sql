-- Append to the migration inside a transaction and ROLLBACK after this test.
do $$ declare admin_id uuid; begin
  select u.auth_user_id into strict admin_id from public.utenti u join public.ruoli r on r.id=u.ruolo_id where u.attivo and r.amministratore_workspace and u.auth_user_id is not null limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
end $$;
set local role authenticated;
do $$ declare summary jsonb; detail jsonb; begin
  summary:=public.crm_b2b_lifecycle_summary();
  select jsonb_build_object('total',count(*),'prospects',count(*) filter(where classificazione='prospect'),
    'first_order',count(*) filter(where classificazione='primo_ordine'),
    'reorders',count(*) filter(where numero_ordini>1),'at_risk',count(*) filter(where classificazione='a_rischio'),
    'dormant',count(*) filter(where classificazione='dormiente'),'lost',count(*) filter(where classificazione='perso')) into detail
  from public.crm_b2b_lifecycle_details();
  if summary-'new_customers' <> detail then raise exception 'KPI/detail mismatch: % vs %',summary,detail;end if;
  if has_function_privilege('anon','public.crm_b2b_lifecycle_details()','execute') then raise exception 'Anonymous access must remain denied';end if;
end $$;
reset role;
select 'PASS: lifecycle detail exactly matches all existing KPI counts; anonymous access denied' result;

begin;

-- The scalar classification predicate rebuilds the entire visible customer set
-- for each row. Use uncorrelated subqueries: PostgreSQL computes the same sets
-- once per statement. No cross-request cache, role changes or timeout increase.
-- Preserve the installed RPC bodies (including order/KPI fixes), signatures,
-- SECURITY DEFINER/INVOKER settings and grants; change only the row predicate.
do $migration$
declare
  signature text;
  original text;
  optimized text;
  predicate_pattern constant text :=
    'public\.crm_customer_classification_visible\([[:space:]]*([[:alnum:]_]+\.[[:alnum:]_]+)[[:space:]]*,[[:space:]]*([[:alnum:]_]+\.[[:alnum:]_]+)[[:space:]]*\)';
  predicate_replacement constant text :=
    '(\1 in (select public.crm_visible_canonical_customer_codes()) and \2 = any((select public.crm_visible_customer_areas())::text[]))';
begin
  foreach signature in array array[
    'public.crm_dashboard_metrics(text,date,date,integer)',
    'public.crm_customer_status_counts(text)',
    'public.crm_customer_metric_details(text,date,date,text,text,integer,integer)',
    'public.crm_customer_metric_details(text,date,date,text,text,integer,integer,text)',
    'public.crm_customer_cadence_details(text,date)',
    'public.crm_customer_country_catalog(text)',
    'public.crm_commercial_control_order_dataset(text,date,date,text,text,text,text,text,text)',
    'public.crm_commercial_control_dashboard_pre_oct_fix(text,date,date,text,text,text,text,text,text,text,text)'
  ] loop
    original := pg_get_functiondef(signature::regprocedure);
    optimized := regexp_replace(original, predicate_pattern, predicate_replacement, 'g');
    if optimized = original then
      raise exception 'Expected row visibility predicate missing in %; refusing partial optimization', signature;
    end if;
    execute optimized;
  end loop;

  -- CREATE OR REPLACE retains ownership, grants and view options.
  original := pg_get_viewdef('public.crm_classified_customers'::regclass, true);
  optimized := regexp_replace(original,
    replace(predicate_pattern, 'public\.', ''), predicate_replacement, 'g');
  if optimized = original then
    raise exception 'Expected predicate missing in crm_classified_customers';
  end if;
  execute 'create or replace view public.crm_classified_customers as ' || optimized;
end $migration$;

notify pgrst, 'reload schema';
commit;

begin;

do $$
declare
  function_oid regprocedure := 'public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text)'::regprocedure;
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(function_oid) into definition;

  updated_definition := replace(
    replace(
      definition,
      'reorder_status, average_gap_days, expected_reorder_date, average_purchase_value',
      'reorder_status, average_gap_days, expected_reorder_date, health.average_purchase_value'
    ),
    'reorder_status, average_purchase_value,',
    'reorder_status, health.average_purchase_value,'
  );

  if updated_definition = definition then
    raise exception 'Definizione crm_commercial_control_dashboard non riconosciuta: proiezione valore medio non qualificata.';
  end if;

  execute updated_definition;
end;
$$;

comment on function public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text) is
  'Dashboard commerciali CRM server-side; proiezioni del valore medio cliente qualificate senza ambiguita.';

commit;

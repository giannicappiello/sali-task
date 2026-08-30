begin;

do $$
declare
  function_oid regprocedure := 'public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text)'::regprocedure;
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(function_oid) into definition;

  updated_definition := replace(
    definition,
    'metric.average_purchase_value',
    'metric.average_purchase_value as lifetime_average_purchase_value'
  );

  if updated_definition = definition then
    raise exception 'Definizione crm_commercial_control_dashboard non riconosciuta: alias duplicato non corretto.';
  end if;

  execute updated_definition;
end;
$$;

comment on function public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text) is
  'Dashboard commerciali CRM server-side; rimossa ambiguita causata dalla doppia proiezione del valore medio cliente.';

commit;

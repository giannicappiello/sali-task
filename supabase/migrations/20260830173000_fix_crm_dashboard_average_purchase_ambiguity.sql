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
      'sum(coalesce(average_purchase_value, 0))::numeric potential_value',
      'sum(coalesce(health.average_purchase_value, 0))::numeric potential_value'
    ),
    'avg(average_purchase_value)::numeric average_order_value',
    'avg(health.average_purchase_value)::numeric average_order_value'
  );

  if updated_definition = definition then
    raise exception 'Definizione crm_commercial_control_dashboard non riconosciuta: qualificazione valore medio non applicata.';
  end if;

  execute updated_definition;
end;
$$;

comment on function public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text) is
  'Dashboard commerciali CRM server-side; valore medio cliente qualificato per evitare ambiguita PL/pgSQL.';

commit;

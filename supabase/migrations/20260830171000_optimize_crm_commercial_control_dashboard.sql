begin;

do $$
declare
  function_oid regprocedure := 'public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text)'::regprocedure;
  definition text;
begin
  select pg_get_functiondef(function_oid) into definition;
  definition := replace(definition, '), invoice_values as (', '), invoice_values as materialized (');
  definition := replace(definition, '), order_values as (', '), order_values as materialized (');
  definition := replace(definition, '), health as (', '), health as materialized (');

  if definition not like '%invoice_values as materialized (%'
     or definition not like '%order_values as materialized (%'
     or definition not like '%health as materialized (%' then
    raise exception 'Definizione crm_commercial_control_dashboard non riconosciuta: ottimizzazione non applicata.';
  end if;

  execute definition;
end;
$$;

comment on function public.crm_commercial_control_dashboard(text,date,date,text,text,text,text,text,text,text,text) is
  'Dashboard commerciali CRM server-side su campi reali; aggregazioni economiche materializzate una volta per richiesta.';

commit;


-- Order-only sources prevent a product reservation lookup from reading invoice lines.
do $orders$ declare f record;definition text;cut integer;name text;begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('crm_dashboard_product_rows','crm_b2b_order_product_rows') loop
  definition:=pg_get_functiondef(f.oid);cut:=strpos(definition,'union all'||chr(10)||'select ''purchased''');
  if cut=0 then raise exception 'Product query contract changed: %',f.proname;end if;
  definition:=left(definition,cut-1)||';'||chr(10)||'$function$;';
  name:=f.proname||'_orders_only';
  definition:=replace(definition,'FUNCTION public.'||f.proname||'(','FUNCTION public.'||name||'(');
  -- The parent order already defines its module. Only separate the dedicated MyPharma customer.
  definition:=replace(definition,'and o.codice_cliente in(select customer_code from public.crm_b2b_order_customers(p_customer_group,p_order_module,p_from,p_to,p_agent))',
   'and (p_customer_group=''all'' or p_customer_group is null or (p_customer_group=''regular'' and o.codice_cliente<>''501.00288'') or (p_customer_group=''mypharma'' and o.codice_cliente=''501.00288''))');
  definition:=replace(definition,'select o.*,cc.ragione_sociale customer_name','select o.id,o.modulo_ordini,o.tipo_ordine,o.numero_ordine_visualizzato,o.numero_ordine,o.numero_progressivo,o.data_ordine,o.stato,o.codice_cliente,cc.ragione_sociale customer_name');
  definition:=replace(replace(definition,'public.crm_sales_orders o','public.ordini_testate o'),'public.crm_sales_order_lines r','public.ordini_righe r');
  definition:=replace(definition,'where a.quantity>0','where upper(btrim(coalesce(r.codice_articolo,'''')))< >''ARTGEN'' and a.quantity>0');
  definition:=replace(definition,'< >','<>');
  execute definition;
  execute format('revoke all on function %s from public,anon,authenticated',replace(f.oid::regprocedure::text,f.proname,name));
  execute format('grant execute on function %s to service_role',replace(f.oid::regprocedure::text,f.proname,name));
 end loop;
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in('crm_dashboard_product_groups_with_agents','crm_b2b_order_product_groups_with_agents','crm_dashboard_product_agents','crm_b2b_order_product_agents','crm_dashboard_product_detail_lines','crm_b2b_order_product_detail_lines') loop
  definition:=pg_get_functiondef(f.oid);
  if strpos(definition,'p_category=''purchased''')>0 or strpos(definition,'p_category = ''purchased''')>0 then
   definition:=replace(replace(definition,'public.crm_dashboard_product_rows(','public.crm_dashboard_product_rows_orders_only('),'public.crm_b2b_order_product_rows(','public.crm_b2b_order_product_rows_orders_only(');
   execute definition;
  end if;
 end loop;
end $orders$;

-- Private overloads retain each existing data scope and authorization check.
-- Pagination is applied once, after global filtering and sorting by the page gateway.
do $clones$ declare f record;definition text;name text;begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[
 'crm_dashboard_product_groups_with_agents','crm_b2b_order_product_groups_with_agents',
 'crm_dashboard_product_agents','crm_b2b_order_product_agents','crm_dashboard_product_detail_lines','crm_b2b_order_product_detail_lines',
 'crm_kpi_opportunities','crm_kpi_activities','crm_b2b_customers_card','crm_b2b_financial_details','crm_private_dashboard_details','crm_commercial_dashboard_details','crm_open_order_category_details',
 'crm_customer_metric_details','crm_b2b_order_customer_details','crm_prospect_customer_details','crm_b2b_lifecycle_details','crm_b2b_order_lifecycle_details'
 ]) loop
  name:=f.proname||'_kpi';
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,'FUNCTION public.'||f.proname||'(','FUNCTION public.'||name||'(');
  definition:=regexp_replace(definition,'[[:space:]]limit (greatest|least)\([^;]*offset [^;]*;',';','gi');
  execute definition;
  execute format('revoke all on function %s from public,anon',replace(f.oid::regprocedure::text,f.proname,name));
  execute format('grant execute on function %s to authenticated,service_role',replace(f.oid::regprocedure::text,f.proname,name));
 end loop;
end $clones$;


create function public.crm_b2b_customers_card_kpi(p_crm_type text,p_from date,p_to date,p_metric text default 'all',p_search text default null,p_customer_status text default 'active')
returns setof jsonb language sql stable security definer set search_path=public as $customers$
 select to_jsonb(c) from public.crm_customer_metric_details_kpi(p_crm_type,p_from,p_to,p_metric,p_search,200,0,p_customer_status)c
 union all
 select to_jsonb(p)||jsonb_build_object('account_id',p.id,'ragione_sociale',p.nome)from public.crm_prospect_customer_details_kpi(p_crm_type,p_search,200,0,p_customer_status)p where p_metric='all'
$customers$;
revoke all on function public.crm_b2b_customers_card_kpi(text,date,date,text,text,text) from public,anon;
grant execute on function public.crm_b2b_customers_card_kpi(text,date,date,text,text,text) to authenticated,service_role;


-- These two sources keep table RLS active, exactly like the previous browser queries.
create function public.crm_kpi_opportunities_kpi(p_crm_type text,p_metric text default null)
returns setof jsonb language sql stable security invoker set search_path=public as $opportunities$
 select to_jsonb(o)||jsonb_build_object('crm_accounts',jsonb_build_object('id',a.id,'nome',a.nome,'tipo',a.tipo,'codice_cliente_mexal',a.codice_cliente_mexal),
 'crm_opportunity_stages',jsonb_build_object('nome',s.nome,'finale',s.finale))
 from crm_opportunities o join crm_accounts a on a.id=o.account_id left join crm_opportunity_stages s on s.id=o.stage_id
 where a.tipo=p_crm_type and not coalesce(s.finale,false) and (p_metric is distinct from 'overdue' or o.chiusura_prevista<(now()at time zone 'Europe/Rome')::date)
$opportunities$;
create function public.crm_kpi_activities_kpi(p_crm_type text)
returns setof jsonb language sql stable security invoker set search_path=public as $activities$
 select to_jsonb(t)||jsonb_build_object('crm_accounts',jsonb_build_object('nome',a.nome,'codice_cliente_mexal',a.codice_cliente_mexal),
 'checklist_template',jsonb_build_object('titolo',c.titolo))
 from crm_activities t left join crm_accounts a on a.id=t.account_id left join checklist_template c on c.id=t.catalog_template_id
 where t.crm_tipo=p_crm_type and t.stato<>'completata' and t.data_attivita<now()
$activities$;
revoke all on function public.crm_kpi_opportunities_kpi(text,text),public.crm_kpi_activities_kpi(text) from public,anon;
grant execute on function public.crm_kpi_opportunities_kpi(text,text),public.crm_kpi_activities_kpi(text) to authenticated,service_role;


create function public.crm_kpi_lifecycle_summary(p_from date,p_to date,p_agent text default null,p_order_module text default null,p_customer_group text default null)
returns jsonb language plpgsql stable security invoker set search_path=public as $lifecycle$
declare source text;result jsonb;begin
 if p_order_module is null then source:='public.crm_b2b_lifecycle_details_kpi()';
 else source:=format('public.crm_b2b_order_lifecycle_details_kpi(%L,%L,%L::date,%L::date,%L)',coalesce(p_customer_group,'all'),p_order_module,p_from,p_to,p_agent);end if;
 execute 'select jsonb_build_object(''prospects'',count(*)filter(where classificazione=''prospect''),''first_order'',count(*)filter(where classificazione=''primo_ordine''),''reorders'',count(*)filter(where numero_ordini>1),''at_risk'',count(*)filter(where classificazione=''a_rischio''),''dormant'',count(*)filter(where classificazione=''dormiente''),''lost'',count(*)filter(where classificazione=''perso''))from '||source||' r where $1 is null or codice_cliente in(select c.codice_cliente from public.ordini_clienti_cache c where c.codice_agente_mexal=$1)' into result using nullif(p_agent,'');
 return result;
end $lifecycle$;
revoke all on function public.crm_kpi_lifecycle_summary(date,date,text,text,text) from public,anon;
grant execute on function public.crm_kpi_lifecycle_summary(date,date,text,text,text) to authenticated,service_role;

create function public.crm_kpi_field(p_row jsonb,p_column jsonb) returns jsonb
language plpgsql immutable set search_path=public as $field$
declare path text;value jsonb;display text;begin
 for path in select jsonb_array_elements_text(coalesce(p_column->'fields',jsonb_build_array(p_column->>'key'))) loop
  value:=p_row#>string_to_array(path,'.');exit when value is not null and value<>'null'::jsonb;
 end loop;
 display:=coalesce(value#>>'{}','');
 if p_column->>'format'='number' and jsonb_typeof(value)='number' then display:=translate(rtrim(to_char((value#>>'{}')::numeric,'FM999,999,999,999,990.999'),'.'),',.','.,');
 elsif p_column->>'format'='money' and jsonb_typeof(value)='number' then display:=translate(to_char((value#>>'{}')::numeric,'FM999,999,999,999,990.00'),',.','.,')||' €';
 elsif p_column->>'format'='date' and display ~ '^\d{4}-\d{2}-\d{2}' then display:=substring(display,9,2)||'-'||substring(display,6,2)||'-'||left(display,4);
 end if;
 return jsonb_build_object('raw',value,'display',display);
end $field$;
revoke all on function public.crm_kpi_field(jsonb,jsonb) from public,anon;
grant execute on function public.crm_kpi_field(jsonb,jsonb) to authenticated,service_role;

create function public.crm_kpi_detail_page(p_source text,p_parameters jsonb,p_columns jsonb,p_search text default '',p_filters jsonb default '{}',p_sort text default '',p_direction text default 'asc',p_limit integer default 25,p_offset integer default 0,p_transform text default 'rows',p_customer text default null,p_document text default null,p_restrictions jsonb default '[]')
returns jsonb language plpgsql stable security invoker set search_path=public set statement_timeout='15s' as $page$
declare f record;arguments text;query text;result jsonb;begin
 if not p_source=any(array[
 'crm_dashboard_product_groups_with_agents','crm_b2b_order_product_groups_with_agents',
 'crm_dashboard_product_agents','crm_b2b_order_product_agents','crm_dashboard_product_detail_lines','crm_b2b_order_product_detail_lines',
 'crm_kpi_opportunities','crm_kpi_activities','crm_b2b_customers_card','crm_b2b_financial_details','crm_private_dashboard_details','crm_commercial_dashboard_details','crm_open_order_category_details',
 'crm_customer_metric_details','crm_b2b_order_customer_details','crm_prospect_customer_details','crm_b2b_lifecycle_details','crm_b2b_order_lifecycle_details'
 ]) then raise exception 'Sorgente KPI non valida' using errcode='22023';end if;
 if p_transform not in('rows','invoice_customers','product_customers','product_documents') then raise exception 'Raggruppamento KPI non valido';end if;
 if jsonb_typeof(p_parameters)<>'object' or jsonb_typeof(p_columns)<>'array' or jsonb_array_length(p_columns)>30 or jsonb_typeof(p_filters)<>'object' then raise exception 'Filtri KPI non validi';end if;
 select p.* into f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname=p_source||'_kpi'
 and not exists(select 1 from jsonb_object_keys(p_parameters) key where not key=any(p.proargnames[1:p.pronargs]))
 and not exists(select 1 from generate_series(1,p.pronargs-p.pronargdefaults)i where not p.proargnames[i]=any(array['p_limit','p_offset']) and not p_parameters?p.proargnames[i])
 order by p.pronargs limit 1;
 if f.oid is null then raise exception 'Parametri KPI non validi';end if;
 select string_agg(format('%I => %L::%s',a.key,a.value#>>'{}',format_type(f.proargtypes[array_position(f.proargnames,a.key)-1],null)),',') into arguments from jsonb_each(p_parameters)a;
 if 'p_limit'=any(f.proargnames) and not p_parameters?'p_limit' then arguments:=concat_ws(',',arguments,'p_limit => 1000');end if;
 if 'p_offset'=any(f.proargnames) and not p_parameters?'p_offset' then arguments:=concat_ws(',',arguments,'p_offset => 0');end if;
 query:=format($query$
 with raw_dataset as materialized(select to_jsonb(s) row,row_number()over() ordinal from public.%I(%s)s),
 scoped as materialized(select * from raw_dataset where ($8 is null or coalesce(row->>'customer_code',row->>'codice_cliente')=$8)and($10 is null or row->>'document_id'=$10)
 and not exists(select 1 from jsonb_array_elements($11)r where not(case r->>'op' when 'neq' then row#>string_to_array(r->>'field','.')<>r->'value' when 'eq' then row#>string_to_array(r->>'field','.')=r->'value' when 'in' then (r->'value') @> jsonb_build_array(row#>string_to_array(r->>'field','.')) when 'gt' then case when jsonb_typeof(row#>string_to_array(r->>'field','.'))='number' then (row#>>string_to_array(r->>'field','.'))::numeric>(r->>'value')::numeric else false end else false end))),
 dataset as materialized(
 select row,ordinal from scoped where $9='rows'
 union all
 select jsonb_build_object('id',row->>'customer_code','customer_code',row->>'customer_code','customer_name',max(row->>'customer_name'),
 'invoice_count',count(*),'documents',count(*),'invoice_total',sum((row->>'amount')::numeric),'amount',sum((row->>'amount')::numeric),'last_invoice',max(row->>'document_date'),'__search',string_agg(coalesce(row->>'title','')||' '||coalesce(row->>'document_date','')||' '||coalesce(to_char((row->>'document_date')::date,'DD-MM-YYYY'),''),' ')),min(ordinal)
 from scoped where $9='invoice_customers' group by row->>'customer_code'
 union all
 select jsonb_build_object('id',row->>'customer_code','customer_code',row->>'customer_code','customer_name',max(row->>'customer_name'),
 'quantity',sum((row->>'quantity')::numeric),'net_amount',sum((row->>'net_amount')::numeric),'unknown_amounts',count(*)filter(where row->>'net_amount' is null),'documents',count(distinct row->>'document_id')),min(ordinal)
 from scoped where $9='product_customers' group by row->>'customer_code'
 union all
 select jsonb_build_object('id',row->>'document_id','document_id',row->>'document_id','document_number',max(row->>'document_number'),'document_date',max(row->>'document_date'),'document_status',max(row->>'document_status'),'customer_code',max(row->>'customer_code'),'customer_name',max(row->>'customer_name'),
 'quantity',sum((row->>'quantity')::numeric),'net_amount',sum((row->>'net_amount')::numeric),'unknown_amounts',count(*)filter(where row->>'net_amount' is null)),min(ordinal)
 from scoped where $9='product_documents' group by row->>'document_id'
 ),
 prepared as materialized(select d.*,(select coalesce(jsonb_object_agg(c->>'key',public.crm_kpi_field(d.row,c)),'{}')from jsonb_array_elements($1)c) fields from dataset d),
 filtered as materialized(select * from prepared p where
  (coalesce($2,'')='' or strpos(lower(coalesce(p.row->>'__search','')),lower($2))>0 or exists(select 1 from jsonb_each(p.fields)v where strpos(lower(v.value->>'display'),lower($2))>0))
  and not exists(select 1 from jsonb_each_text($3)v where v.value<>'' and strpos(lower(coalesce(p.fields#>>array[v.key,'display'],'')),lower(v.value))=0)),
 paged as(select * from filtered order by
  case when $5='asc' then fields#>array[$4,'raw']end asc nulls last,
  case when $5='desc' then fields#>array[$4,'raw']end desc nulls last,ordinal
 limit $6 offset $7)
 select jsonb_build_object('rows',(select coalesce(jsonb_agg(row-'__search'),'[]')from paged),'total',(select count(*)from filtered),'available',(select count(*)from dataset),
 'sums',(select coalesce(jsonb_object_agg(c->>'key',(select sum((fields#>>array[c->>'key','raw'])::numeric)from filtered where jsonb_typeof(fields#>array[c->>'key','raw'])='number')),'{}')from jsonb_array_elements($1)c where c->>'format' in('money','number')))
 $query$,p_source||'_kpi',coalesce(arguments,''));
 execute query into result using p_columns,left(p_search,300),p_filters,p_sort,case when p_direction='desc' then 'desc' else 'asc' end,greatest(1,least(coalesce(p_limit,25),100)),greatest(coalesce(p_offset,0),0),p_customer,p_transform,p_document,p_restrictions;
 return result;
end $page$;
revoke all on function public.crm_kpi_detail_page(text,jsonb,jsonb,text,jsonb,text,text,integer,integer,text,text,text,jsonb) from public,anon;
grant execute on function public.crm_kpi_detail_page(text,jsonb,jsonb,text,jsonb,text,text,integer,integer,text,text,text,jsonb) to authenticated,service_role;
notify pgrst,'reload schema';

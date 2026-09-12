begin;
set local lock_timeout='5s';

-- A screen may be catalogued before an administrator assigns its areas/modules.
-- Empty areas grant nothing; existing screen assignments and data RLS are unchanged.
alter table public.workspace_schermate drop constraint workspace_screen_areas_nonempty;
alter table public.workspace_schermate alter column area drop not null;
create or replace function public.workspace_normalize_screen_areas()
returns trigger language plpgsql set search_path=public as $fn$
begin
  if tg_op='INSERT' and cardinality(coalesce(new.aree,'{}'))=0 and new.area is not null then
    new.aree=array[new.area];
  end if;
  select coalesce(array_agg(code order by first_position),'{}') into new.aree
  from (select lower(btrim(value)) code,min(position) first_position
    from unnest(new.aree) with ordinality a(value,position)
    where nullif(btrim(value),'') is not null group by lower(btrim(value))) normalized;
  new.area=new.aree[1];
  return new;
end $fn$;
-- Preserve the current admin-only save implementation and all its validations
-- except the requirement to select an area before a screen can be saved.
do $patch$
declare definition text; required_check text := 'if cardinality(selected_areas)=0 then raise exception ''Seleziona almeno un’area per la schermata.''; end if;';
begin
  definition:=pg_get_functiondef('public.admin_update_workspace_screen(jsonb)'::regprocedure);
  if strpos(definition,required_check)=0 then raise exception 'Screen save function changed: review empty-area support'; end if;
  execute replace(definition,required_check,'-- Empty area list is valid: assignments are administrator-managed.');
end $patch$;

insert into public.workspace_schermate(codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,aree,icona)
values
 ('crm.prodotti_ordinati','Prodotti ordinati del cliente','Prodotti, quantità e storico completo degli ordini del cliente.','workspace','/crm/prodotti-ordinati','crm.customer_ordered_products',false,true,36,null,'{}','shopping-cart'),
 ('crm.prodotti_acquistati','Prodotti acquistati del cliente','Prodotti e storico dei documenti di vendita del cliente.','workspace','/crm/prodotti-acquistati','crm.customer_purchased_products',false,true,37,null,'{}','package')
on conflict(codice) do update set percorso=excluded.percorso,chiave_componente=excluded.chiave_componente;

-- Caller-scoped line projection. No parent CRM/order module grant is added here.
-- The existing customer, order and invoice row policies remain authoritative.
create function public.crm_customer_product_lines(p_customer_key text,p_kind text,p_crm_type text default null)
returns table(line_id text,document_id uuid,document_number text,document_date date,
  document_type text,document_status text,customer_code text,customer_name text,
  product_code text,description text,quantity numeric,unit text,unit_price numeric,
  discount text,net_amount numeric,is_credit boolean,excluded_from_totals boolean,
  line_position integer,remaining_quantity numeric)
language plpgsql stable security invoker set search_path=public as $lines$
begin
  if p_kind not in ('ordered','purchased') or p_kind is null then
    raise exception 'Tipo prodotti non valido' using errcode='22023';
  end if;
  if p_crm_type is not null and p_crm_type not in ('b2b','online') then
    raise exception 'Contesto CRM non valido' using errcode='22023';
  end if;
  return query
  with customer as materialized (
    select c.codice_cliente,c.ragione_sociale from public.crm_classified_customers c
    where c.area_crm in ('b2b','online') and (p_crm_type is null or c.area_crm=p_crm_type) and ('mexal:'||c.codice_cliente=p_customer_key or exists(
      select 1 from public.crm_accounts a where 'crm:'||a.id::text=p_customer_key
        and a.tipo=c.area_crm and a.codice_cliente_mexal=c.codice_cliente))
  ), lines as (
    select 'order:'||l.id::text line_id,o.id document_id,
      coalesce(nullif(o.numero_ordine_visualizzato,''),nullif(o.numero_ordine,''),o.id::text) document_number,
      o.data_ordine document_date,coalesce(o.mexal_sigla,'Ordine') document_type,
      o.stato document_status,c.codice_cliente customer_code,c.ragione_sociale customer_name,
      l.codice_articolo product_code,coalesce(nullif(l.descrizione,''),l.codice_articolo) description,
      l.quantita quantity,nullif(btrim(l.unita_misura_oct),'') unit,l.prezzo_listino unit_price,
      coalesce(nullif(concat_ws(' + ',nullif(l.sconto_commerciale,''),nullif(l.sconto_pagamento,'')),''),nullif(l.sconto_percentuale,0)::text) discount,
      l.imponibile_riga net_amount,false is_credit,
      lower(coalesce(o.stato,'')) in ('annullato','annullata','cancellato','cancellata') excluded_from_totals,
      coalesce(l.mexal_posizione,0) line_position,null::numeric remaining_quantity
    from customer c join public.crm_order_kpi_source o on o.codice_cliente=c.codice_cliente
    join public.ordini_righe l on l.ordine_id=o.id
    where p_kind='ordered' and not l.riga_descrittiva and l.mexal_attiva
      and nullif(btrim(l.codice_articolo),'') is not null
    union all
    select 'invoice:'||l.id::text,f.id,f.sigla||f.cod_modulo||' '||f.serie||'/'||f.numero,
      f.data_documento,f.sigla,'Documento sincronizzato',c.codice_cliente,c.ragione_sociale,
      l.codice_articolo,coalesce(nullif(l.descrizione,''),l.codice_articolo),
      case when upper(f.sigla)='NC' then -abs(l.quantita) else l.quantita end,
      coalesce(nullif(l.dati_mexal->>'unita_misura',''),nullif(l.dati_mexal->>'um','')),
      l.prezzo_unitario,l.sconto,
      case when upper(f.sigla)='NC' then -abs(l.valore_netto) else l.valore_netto end,
      upper(f.sigla)='NC' or f.totale_imponibile<0,false,l.posizione,null::numeric
    from customer c join public.mexal_fatture_vendita f on f.codice_cliente=c.codice_cliente
    join public.mexal_fatture_vendita_righe l on l.fattura_id=f.id
    where p_kind='purchased' and upper(f.sigla)<>'OC' and nullif(btrim(l.codice_articolo),'') is not null
  ) select x.* from lines x order by x.document_date desc nulls last,x.document_id,x.line_position,x.line_id;
end $lines$;
revoke all on function public.crm_customer_product_lines(text,text,text) from public,anon;
grant execute on function public.crm_customer_product_lines(text,text,text) to authenticated,service_role;
notify pgrst,'reload schema';
commit;

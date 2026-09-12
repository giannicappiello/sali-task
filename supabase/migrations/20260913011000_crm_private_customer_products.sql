begin;

-- Extend the existing shared product screens to PRIVATE. Keep catalog assignments,
-- document calculations and caller-scoped row policies unchanged.
create or replace function public.crm_customer_product_lines(p_customer_key text,p_kind text,p_crm_type text default null)
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
  if p_crm_type is not null and p_crm_type not in ('conto_terzi','b2b','online') then
    raise exception 'Contesto CRM non valido' using errcode='22023';
  end if;
  return query
  with customer as materialized (
    select c.codice_cliente,c.ragione_sociale from public.crm_classified_customers c
    where c.area_crm in ('conto_terzi','b2b','online') and (p_crm_type is null or c.area_crm=p_crm_type) and ('mexal:'||c.codice_cliente=p_customer_key or exists(
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

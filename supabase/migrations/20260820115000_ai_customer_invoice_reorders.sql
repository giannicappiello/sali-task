begin;

create or replace function public.workspace_ai_customer_reorder_context(
  p_customer_limit integer default 50,
  p_product_limit integer default 30
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with access_context as materialized (
    select
      u.id,
      coalesce(r.amministratore_workspace, false) as workspace_admin,
      coalesce(r.livello_accesso, 'lettura') as livello_accesso,
      lower(btrim(coalesce(r.nome, ''))) as ruolo
    from public.utenti u
    left join public.ruoli r on r.id = u.ruolo_id
    where u.auth_user_id = auth.uid()
      and u.attivo is not false
  ), full_invoice_access as materialized (
    select
      exists (
        select 1
        from access_context
        where workspace_admin
           or livello_accesso = 'amministrazione'
           or ruolo in ('admin', 'administrator', 'amministratore', 'super admin', 'direzione')
      )
      or exists (
        select 1
        from public.integrazioni_utenti iu
        join access_context me on me.id = iu.utente_id
        where iu.enabled is true
          and iu.modulo in ('gestione_ordini_pr', 'gestione_ordini_ph')
          and iu.ruolo_ordini = 'backoffice'
      ) as allowed
  ), visible_agent_codes as materialized (
    select public.visible_mexal_agent_codes() as codice
  ), visible_headers as materialized (
    select
      f.*,
      coalesce(
        nullif(btrim(f.codice_cliente), ''),
        nullif(lower(btrim(f.ragione_sociale_cliente)), ''),
        f.id::text
      ) as customer_key
    from public.mexal_fatture_vendita f
    where exists (select 1 from full_invoice_access where allowed)
       or nullif(btrim(coalesce(f.codice_agente_mexal, '')), '') in (
         select codice from visible_agent_codes
       )
  ), invoice_products as materialized (
    select
      f.customer_key,
      f.codice_cliente,
      f.ragione_sociale_cliente,
      f.id as fattura_id,
      f.data_documento,
      f.sigla,
      f.cod_modulo,
      f.serie,
      f.numero,
      r.codice_articolo,
      max(r.descrizione) as descrizione,
      sum(r.quantita) as quantita,
      sum(r.valore_netto) as valore_netto
    from visible_headers f
    join public.mexal_fatture_vendita_righe r on r.fattura_id = f.id
    where nullif(btrim(coalesce(r.codice_articolo, '')), '') is not null
    group by
      f.customer_key, f.codice_cliente, f.ragione_sociale_cliente,
      f.id, f.data_documento, f.sigla, f.cod_modulo, f.serie, f.numero,
      r.codice_articolo
  ), customer_totals as materialized (
    select
      customer_key,
      max(codice_cliente) as codice_cliente,
      max(ragione_sociale_cliente) as cliente,
      count(*) as numero_fatture,
      min(data_documento) as prima_fattura,
      max(data_documento) as ultima_fattura,
      sum(totale_documento) as totale_documenti
    from visible_headers
    group by customer_key
    order by count(*) desc, sum(totale_documento) desc nulls last
    limit greatest(1, least(coalesce(p_customer_limit, 50), 150))
  ), product_stats as materialized (
    select
      customer_key,
      codice_articolo,
      max(descrizione) as descrizione,
      count(*) as numero_fatture_con_prodotto,
      min(data_documento) as prima_fattura,
      max(data_documento) as ultima_fattura,
      sum(quantita) as quantita_totale,
      sum(valore_netto) as valore_netto_totale
    from invoice_products
    group by customer_key, codice_articolo
  ), customer_product_rollup as (
    select
      c.*,
      count(ps.codice_articolo) as prodotti_distinti,
      count(ps.codice_articolo) filter (where ps.numero_fatture_con_prodotto > 1) as prodotti_riordinati,
      coalesce(sum(ps.valore_netto_totale), 0) as valore_netto_righe
    from customer_totals c
    left join product_stats ps on ps.customer_key = c.customer_key
    group by
      c.customer_key, c.codice_cliente, c.cliente, c.numero_fatture,
      c.prima_fattura, c.ultima_fattura, c.totale_documenti
  ), classified_customers as (
    select
      c.*,
      case
        when c.prodotti_riordinati = 0 then 'nessun prodotto ripetuto'
        when c.prodotti_riordinati = c.prodotti_distinti then 'riordino completo'
        else 'riordino parziale'
      end as classificazione
    from customer_product_rollup c
  )
  select jsonb_build_object(
    'origine', 'fatture di vendita e relative righe dalla cache Mexal sincronizzata',
    'criterio_classificazione', jsonb_build_object(
      'riordino_completo', 'tutti i codici articolo distinti del cliente compaiono in almeno due fatture',
      'riordino_parziale', 'solo una parte dei codici articolo distinti compare in almeno due fatture',
      'nessun_prodotto_ripetuto', 'nessun codice articolo compare in più di una fattura'
    ),
    'copertura', jsonb_build_object(
      'dal', (select min(data_documento) from visible_headers),
      'al', (select max(data_documento) from visible_headers),
      'fatture_analizzate', (select count(*) from visible_headers),
      'righe_analizzate', (
        select count(*)
        from public.mexal_fatture_vendita_righe r
        join visible_headers f on f.id = r.fattura_id
      ),
      'righe_senza_valore_netto', (
        select count(*)
        from public.mexal_fatture_vendita_righe r
        join visible_headers f on f.id = r.fattura_id
        where r.valore_netto is null
      )
    ),
    'clienti_per_numero_fatture', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'codice_cliente', c.codice_cliente,
          'cliente', c.cliente,
          'numero_fatture', c.numero_fatture,
          'prima_fattura', c.prima_fattura,
          'ultima_fattura', c.ultima_fattura,
          'totale_documenti', c.totale_documenti,
          'valore_netto_righe', c.valore_netto_righe,
          'prodotti_distinti', c.prodotti_distinti,
          'prodotti_riordinati', c.prodotti_riordinati,
          'classificazione', c.classificazione,
          'dettaglio_prodotti_riordinati', coalesce((
            select jsonb_agg(to_jsonb(reordered) order by reordered.numero_fatture_con_prodotto desc, reordered.valore_netto_totale desc nulls last)
            from (
              select
                ps.codice_articolo,
                ps.descrizione,
                ps.numero_fatture_con_prodotto,
                ps.prima_fattura,
                ps.ultima_fattura,
                ps.quantita_totale,
                ps.valore_netto_totale
              from product_stats ps
              where ps.customer_key = c.customer_key
                and ps.numero_fatture_con_prodotto > 1
              order by ps.numero_fatture_con_prodotto desc, ps.valore_netto_totale desc nulls last
              limit greatest(1, least(coalesce(p_product_limit, 30), 100))
            ) reordered
          ), '[]'::jsonb)
        )
        order by c.numero_fatture desc, c.totale_documenti desc nulls last
      )
      from classified_customers c
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.workspace_ai_customer_reorder_context(integer, integer) from public, anon;
grant execute on function public.workspace_ai_customer_reorder_context(integer, integer) to authenticated, service_role;

commit;

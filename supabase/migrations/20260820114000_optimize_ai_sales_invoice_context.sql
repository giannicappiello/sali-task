begin;

create or replace function public.workspace_ai_sales_invoice_context(p_limit integer default 80)
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
    select f.*
    from public.mexal_fatture_vendita f
    where exists (select 1 from full_invoice_access where allowed)
       or nullif(btrim(coalesce(f.codice_agente_mexal, '')), '') in (
         select codice from visible_agent_codes
       )
  ), visible_lines as materialized (
    select
      f.id as fattura_id,
      f.data_documento,
      f.sigla,
      f.cod_modulo,
      f.serie,
      f.numero,
      f.codice_cliente,
      f.ragione_sociale_cliente,
      r.posizione,
      r.codice_articolo,
      r.descrizione,
      r.quantita,
      r.prezzo_unitario,
      r.sconto,
      r.valore_lordo,
      r.prezzo_netto_unitario,
      r.valore_netto,
      r.valore_netto_origine
    from visible_headers f
    join public.mexal_fatture_vendita_righe r on r.fattura_id = f.id
  ), product_totals as (
    select
      codice_articolo,
      max(descrizione) as descrizione,
      count(distinct fattura_id) as numero_fatture,
      sum(quantita) as quantita,
      sum(valore_lordo) as valore_lordo,
      sum(valore_netto) as valore_netto,
      count(*) filter (where valore_netto is null) as righe_senza_valore_netto
    from visible_lines
    where nullif(btrim(coalesce(codice_articolo, '')), '') is not null
    group by codice_articolo
    order by sum(valore_netto) desc nulls last, sum(valore_lordo) desc nulls last
    limit greatest(1, least(coalesce(p_limit, 80), 200))
  ), recent_headers as (
    select f.*
    from visible_headers f
    order by f.data_documento desc, f.numero desc
    limit 25
  )
  select jsonb_build_object(
    'criterio_classifica', 'somma del valore netto scontato delle righe, IVA esclusa',
    'copertura', jsonb_build_object(
      'dal', (select min(data_documento) from visible_lines),
      'al', (select max(data_documento) from visible_lines),
      'fatture', (select count(distinct fattura_id) from visible_lines),
      'righe', (select count(*) from visible_lines),
      'righe_senza_valore_netto', (select count(*) from visible_lines where valore_netto is null)
    ),
    'prodotti_per_fatturato_netto', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.valore_netto desc nulls last, p.valore_lordo desc nulls last)
      from product_totals p
    ), '[]'::jsonb),
    'fatture_recenti', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id,
        'documento', concat(h.sigla, h.cod_modulo, ' ', h.serie, '/', h.numero),
        'data', h.data_documento,
        'cliente', coalesce(h.ragione_sociale_cliente, h.codice_cliente),
        'totale_documento', h.totale_documento,
        'righe', coalesce((
          select jsonb_agg(jsonb_build_object(
            'posizione', r.posizione,
            'codice_articolo', r.codice_articolo,
            'descrizione', r.descrizione,
            'quantita', r.quantita,
            'prezzo_unitario', r.prezzo_unitario,
            'sconto', r.sconto,
            'prezzo_netto_unitario', r.prezzo_netto_unitario,
            'valore_netto', r.valore_netto,
            'valore_netto_origine', r.valore_netto_origine
          ) order by r.posizione)
          from public.mexal_fatture_vendita_righe r
          where r.fattura_id = h.id
        ), '[]'::jsonb)
      ) order by h.data_documento desc, h.numero desc)
      from recent_headers h
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.workspace_ai_sales_invoice_context(integer) from public, anon;
grant execute on function public.workspace_ai_sales_invoice_context(integer) to authenticated, service_role;

commit;

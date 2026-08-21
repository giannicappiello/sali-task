begin;

alter table public.mexal_fatture_vendita_righe
  add column if not exists valore_lordo numeric(16,6),
  add column if not exists prezzo_netto_unitario numeric(16,6),
  add column if not exists sconto_percentuale_equivalente numeric(9,6),
  add column if not exists valore_netto numeric(16,6),
  add column if not exists valore_netto_origine text;

alter table public.mexal_fatture_vendita_righe
  drop constraint if exists mexal_fatture_righe_valore_netto_origine_check;
alter table public.mexal_fatture_vendita_righe
  add constraint mexal_fatture_righe_valore_netto_origine_check
  check (valore_netto_origine is null or valore_netto_origine in (
    'mexal', 'calcolato_da_sconto', 'prezzo_pieno', 'non_disponibile'
  ));

create or replace function pg_temp.mexal_discounted_value(p_amount numeric, p_discount text)
returns numeric
language plpgsql immutable
as $$
declare
  result numeric := p_amount;
  item text;
  percentage numeric;
begin
  if nullif(btrim(coalesce(p_discount, '')), '') is null then
    return round(p_amount, 6);
  end if;
  foreach item in array regexp_split_to_array(replace(p_discount, '%', ''), '\+') loop
    item := replace(btrim(item), ',', '.');
    if item !~ '^-?[0-9]+([.][0-9]+)?$' then return null; end if;
    percentage := item::numeric;
    if percentage < -100 or percentage > 100 then return null; end if;
    result := result * (1 - percentage / 100);
  end loop;
  return round(result, 6);
end;
$$;

update public.mexal_fatture_vendita_righe
set valore_lordo = round(quantita * prezzo_unitario, 6),
    valore_netto = pg_temp.mexal_discounted_value(quantita * prezzo_unitario, sconto),
    prezzo_netto_unitario = case
      when quantita = 0 then null
      else round(pg_temp.mexal_discounted_value(quantita * prezzo_unitario, sconto) / quantita, 6)
    end,
    sconto_percentuale_equivalente = case
      when quantita * prezzo_unitario = 0 then null
      else round((1 - pg_temp.mexal_discounted_value(quantita * prezzo_unitario, sconto) / (quantita * prezzo_unitario)) * 100, 6)
    end,
    valore_netto_origine = case
      when pg_temp.mexal_discounted_value(quantita * prezzo_unitario, sconto) is null then 'non_disponibile'
      when nullif(btrim(coalesce(sconto, '')), '') is null then 'prezzo_pieno'
      else 'calcolato_da_sconto'
    end
where valore_netto is null;

create or replace function public.workspace_ai_sales_invoice_context(p_limit integer default 80)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with visible_lines as (
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
    from public.mexal_fatture_vendita f
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
    from public.mexal_fatture_vendita f
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

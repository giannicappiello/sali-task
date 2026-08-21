begin;

alter table public.mexal_fatture_vendita_righe
  drop constraint if exists mexal_fatture_righe_valore_netto_origine_check;
alter table public.mexal_fatture_vendita_righe
  add constraint mexal_fatture_righe_valore_netto_origine_check
  check (valore_netto_origine is null or valore_netto_origine in (
    'mexal', 'mexal_prezzo_netto', 'calcolato_da_sconto', 'prezzo_pieno',
    'calcolato_sconti_documento', 'calcolato_sconti_scorporo_iva', 'non_disponibile'
  ));

create or replace function pg_temp.mexal_line_discounted_value(p_amount numeric, p_discount text)
returns numeric
language plpgsql immutable
as $$
declare
  result numeric := p_amount;
  item text;
  percentage numeric;
begin
  if nullif(btrim(coalesce(p_discount, '')), '') is null then return round(p_amount, 6); end if;
  if upper(regexp_replace(btrim(p_discount), '[.[:space:]]', '', 'g')) = 'SCMERCE' then return 0; end if;
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

create or replace function pg_temp.mexal_document_discounted_value(p_amount numeric, p_discounts jsonb)
returns numeric
language plpgsql immutable
as $$
declare
  result numeric := p_amount;
  item jsonb;
  raw_value text;
  percentage numeric;
begin
  if p_amount is null then return null; end if;
  if jsonb_typeof(p_discounts) <> 'array' then return round(p_amount, 6); end if;
  for item in select value from jsonb_array_elements(p_discounts) loop
    if jsonb_typeof(item) <> 'array' or jsonb_array_length(item) = 0 then continue; end if;
    raw_value := replace(item ->> (jsonb_array_length(item) - 1), ',', '.');
    if raw_value !~ '^-?[0-9]+([.][0-9]+)?$' then continue; end if;
    percentage := raw_value::numeric;
    if percentage < -100 or percentage > 100 then continue; end if;
    result := result * (1 - percentage / 100);
  end loop;
  return round(result, 6);
end;
$$;

with recalculated as (
  select
    r.id,
    r.quantita,
    r.valore_lordo,
    r.aliquota_iva,
    r.sconto,
    f.sigla,
    f.cod_modulo,
    coalesce(f.dati_mexal -> 'sc_merce_doc', '[]'::jsonb) as document_discounts,
    pg_temp.mexal_document_discounted_value(
      pg_temp.mexal_line_discounted_value(r.valore_lordo, r.sconto),
      coalesce(f.dati_mexal -> 'sc_merce_doc', '[]'::jsonb)
    ) as discounted_value
  from public.mexal_fatture_vendita_righe r
  join public.mexal_fatture_vendita f on f.id = r.fattura_id
  where coalesce(r.valore_netto_origine, '') <> 'mexal'
), final_values as (
  select
    *,
    case
      when sigla in ('CO', 'OC') and cod_modulo = 'X' and coalesce(aliquota_iva, 0) > 0
        then round(discounted_value / (1 + aliquota_iva / 100), 6)
      else discounted_value
    end as reconciled_value,
    case
      when discounted_value is null then 'non_disponibile'
      when sigla in ('CO', 'OC') and cod_modulo = 'X' and coalesce(aliquota_iva, 0) > 0
        then 'calcolato_sconti_scorporo_iva'
      when jsonb_array_length(document_discounts) > 0 then 'calcolato_sconti_documento'
      when nullif(btrim(coalesce(sconto, '')), '') is not null then 'calcolato_da_sconto'
      else 'prezzo_pieno'
    end as reconciled_origin
  from recalculated
)
update public.mexal_fatture_vendita_righe r
set
  valore_netto = f.reconciled_value,
  prezzo_netto_unitario = case when f.quantita = 0 or f.reconciled_value is null then null else round(f.reconciled_value / f.quantita, 6) end,
  sconto_percentuale_equivalente = case
    when coalesce(f.valore_lordo, 0) = 0 or f.reconciled_value is null then null
    else round((1 - f.reconciled_value / f.valore_lordo) * 100, 6)
  end,
  valore_netto_origine = f.reconciled_origin,
  dati_mexal = coalesce(r.dati_mexal, '{}'::jsonb) || jsonb_build_object(
    'sconti_merce_documento', f.document_discounts,
    'prezzo_include_iva', f.sigla in ('CO', 'OC') and f.cod_modulo = 'X'
  )
from final_values f
where r.id = f.id;

commit;

-- Backfill cached products from the real Mexal article-detail field.
-- /articoli/{codice} returns the VAT code/value in alq_iva (for example 22,0).
update public.ordini_prodotti_cache
set codice_iva_mexal = nullif(trim(dati_mexal ->> 'alq_iva'), ''),
    aliquota_iva = nullif(replace(trim(dati_mexal ->> 'alq_iva'), ',', '.'), '')::numeric
where nullif(trim(dati_mexal ->> 'alq_iva'), '') is not null;

update public.prodotti
set codice_iva_mexal = nullif(trim(json_mexal ->> 'alq_iva'), ''),
    aliquota_iva = nullif(replace(trim(json_mexal ->> 'alq_iva'), ',', '.'), '')::numeric
where nullif(trim(json_mexal ->> 'alq_iva'), '') is not null;

-- Correzione successiva alla verifica dei dati reali sincronizzati da Mexal.
-- Nell'anagrafica cliente il codice interno destinatario e' esposto come cod_ind_sped
-- (es. 754), mentre nel documento ordine deve essere inviato come cod_anag_sped.

create or replace function public.ordini_compila_destinazione_cliente_mexal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cliente_json jsonb;
  destinazione jsonb;
  codice_anagrafico_spedizione text;
begin
  if new.codice_cliente is null or btrim(new.codice_cliente) = '' then
    return new;
  end if;

  select coalesce(c.json_mexal, c.dati_mexal, '{}'::jsonb)
    into cliente_json
  from public.ordini_clienti_cache c
  where c.codice_cliente = new.codice_cliente
  limit 1;

  if cliente_json is null or cliente_json = '{}'::jsonb then
    return new;
  end if;

  codice_anagrafico_spedizione := coalesce(
    nullif(btrim(cliente_json ->> 'cod_ind_sped'), ''),
    nullif(btrim(cliente_json ->> 'cod_anag_sped'), ''),
    nullif(btrim(cliente_json ->> 'codice_anagrafica_spedizione'), ''),
    nullif(btrim(cliente_json ->> 'cod_anag'), ''),
    nullif(btrim(cliente_json ->> 'id_anag'), ''),
    nullif(btrim(cliente_json ->> 'id_anagrafica'), '')
  );

  destinazione := jsonb_strip_nulls(jsonb_build_object(
    'cod_anag_sped', codice_anagrafico_spedizione,
    'destinatario', coalesce(
      nullif(btrim(cliente_json ->> 'denominazione'), ''),
      nullif(btrim(cliente_json ->> 'ragione_sociale'), ''),
      nullif(btrim(concat_ws(' ', cliente_json ->> 'nome', cliente_json ->> 'cognome')), '')
    ),
    'indirizzo', nullif(btrim(cliente_json ->> 'indirizzo'), ''),
    'cap', nullif(btrim(cliente_json ->> 'cap'), ''),
    'localita', nullif(btrim(cliente_json ->> 'localita'), ''),
    'provincia', nullif(btrim(cliente_json ->> 'provincia'), '')
  ));

  if destinazione <> '{}'::jsonb then
    new.destinazione_mexal := destinazione;
  end if;

  return new;
end;
$$;

-- Aggiorna anche gli ordini gia' creati ma non ancora sincronizzati con Mexal.
update public.ordini_testate o
set destinazione_mexal = jsonb_strip_nulls(jsonb_build_object(
  'cod_anag_sped', coalesce(
    nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'cod_ind_sped'), ''),
    nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'cod_anag_sped'), ''),
    nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'codice_anagrafica_spedizione'), ''),
    nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'cod_anag'), ''),
    nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'id_anag'), ''),
    nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'id_anagrafica'), '')
  ),
  'destinatario', coalesce(
    nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'denominazione'), ''),
    nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'ragione_sociale'), ''),
    nullif(btrim(concat_ws(' ',
      coalesce(c.json_mexal, c.dati_mexal) ->> 'nome',
      coalesce(c.json_mexal, c.dati_mexal) ->> 'cognome'
    )), '')
  ),
  'indirizzo', nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'indirizzo'), ''),
  'cap', nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'cap'), ''),
  'localita', nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'localita'), ''),
  'provincia', nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'provincia'), '')
))
from public.ordini_clienti_cache c
where c.codice_cliente = o.codice_cliente
  and o.sincronizzato_mexal_il is null
  and coalesce(c.json_mexal, c.dati_mexal) is not null;

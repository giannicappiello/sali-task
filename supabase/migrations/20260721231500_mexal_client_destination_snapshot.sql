-- Salva sull'ordine uno snapshot della destinazione ricavata dall'anagrafica cliente Mexal.
-- Se non esiste una destinazione alternativa viene usata l'anagrafica principale.

alter table public.ordini_testate
  add column if not exists destinazione_mexal jsonb;

create or replace function public.ordini_compila_destinazione_cliente_mexal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cliente_json jsonb;
  destinazione jsonb;
  codice_indirizzo text;
begin
  if new.codice_cliente is null or btrim(new.codice_cliente) = '' then
    return new;
  end if;

  -- Non sovrascrive una destinazione già scelta o modificata esplicitamente.
  if new.destinazione_mexal is not null
     and jsonb_typeof(new.destinazione_mexal) = 'object'
     and new.destinazione_mexal <> '{}'::jsonb then
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

  codice_indirizzo := nullif(btrim(cliente_json ->> 'cod_ind_sped'), '');

  destinazione := jsonb_strip_nulls(jsonb_build_object(
    'cod_anag_sped', new.codice_cliente,
    'id_ind_sped', case
      when codice_indirizzo ~ '^\d+$' then codice_indirizzo::integer
      else 0
    end,
    'cod_ind_sped', codice_indirizzo,
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

drop trigger if exists trg_ordini_compila_destinazione_cliente_mexal
on public.ordini_testate;

create trigger trg_ordini_compila_destinazione_cliente_mexal
before insert or update of codice_cliente, destinazione_mexal
on public.ordini_testate
for each row
execute function public.ordini_compila_destinazione_cliente_mexal();

-- Backfill degli ordini non ancora sincronizzati e privi di destinazione.
update public.ordini_testate o
set destinazione_mexal = jsonb_strip_nulls(jsonb_build_object(
  'cod_anag_sped', o.codice_cliente,
  'id_ind_sped', case
    when nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'cod_ind_sped'), '') ~ '^\d+$'
      then (coalesce(c.json_mexal, c.dati_mexal) ->> 'cod_ind_sped')::integer
    else 0
  end,
  'cod_ind_sped', nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'cod_ind_sped'), ''),
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
  and (o.destinazione_mexal is null or o.destinazione_mexal = '{}'::jsonb)
  and o.sincronizzato_mexal_il is null
  and coalesce(c.json_mexal, c.dati_mexal) is not null;

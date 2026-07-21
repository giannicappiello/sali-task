-- Usa i valori di trasporto dell'anagrafica cliente Mexal come snapshot ordine.
-- Il payload ordine li invia già tramite `trasporto_mexal`.

create or replace function public.ordini_compila_trasporto_cliente_mexal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cliente_json jsonb;
  trasporto jsonb;
begin
  if new.codice_cliente is null or btrim(new.codice_cliente) = '' then
    return new;
  end if;

  -- Mantiene un eventuale override esplicito già presente sull'ordine.
  if new.trasporto_mexal is not null
     and jsonb_typeof(new.trasporto_mexal) = 'object'
     and new.trasporto_mexal <> '{}'::jsonb then
    return new;
  end if;

  select coalesce(c.json_mexal, c.dati_mexal, '{}'::jsonb)
    into cliente_json
  from public.ordini_clienti_cache c
  where c.codice_cliente = new.codice_cliente
  limit 1;

  if cliente_json is null then
    return new;
  end if;

  trasporto := jsonb_strip_nulls(jsonb_build_object(
    'tp_trasporto', nullif(btrim(cliente_json ->> 'tp_trasporto'), ''),
    'cod_vettore', nullif(btrim(cliente_json ->> 'cod_vettore'), ''),
    'tp_porto', nullif(btrim(cliente_json ->> 'tp_porto'), ''),
    'tp_spese_sped', nullif(btrim(cliente_json ->> 'tp_spese_sped'), ''),
    'val_spese_sped', case
      when nullif(btrim(cliente_json ->> 'spese_sped'), '') is null then null
      else (cliente_json ->> 'spese_sped')::numeric
    end,
    'fino_spese_sped', case
      when nullif(btrim(cliente_json ->> 'fino_spese_sped'), '') is null then null
      else (cliente_json ->> 'fino_spese_sped')::numeric
    end
  ));

  if trasporto <> '{}'::jsonb then
    new.trasporto_mexal := trasporto;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ordini_compila_trasporto_cliente_mexal on public.ordini_testate;
create trigger trg_ordini_compila_trasporto_cliente_mexal
before insert or update of codice_cliente, trasporto_mexal
on public.ordini_testate
for each row
execute function public.ordini_compila_trasporto_cliente_mexal();

-- Aggiorna anche gli ordini non ancora sincronizzati, senza sovrascrivere override.
update public.ordini_testate o
set trasporto_mexal = jsonb_strip_nulls(jsonb_build_object(
  'tp_trasporto', nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'tp_trasporto'), ''),
  'cod_vettore', nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'cod_vettore'), ''),
  'tp_porto', nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'tp_porto'), ''),
  'tp_spese_sped', nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'tp_spese_sped'), ''),
  'val_spese_sped', case
    when nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'spese_sped'), '') is null then null
    else (coalesce(c.json_mexal, c.dati_mexal) ->> 'spese_sped')::numeric
  end,
  'fino_spese_sped', case
    when nullif(btrim(coalesce(c.json_mexal, c.dati_mexal) ->> 'fino_spese_sped'), '') is null then null
    else (coalesce(c.json_mexal, c.dati_mexal) ->> 'fino_spese_sped')::numeric
  end
))
from public.ordini_clienti_cache c
where c.codice_cliente = o.codice_cliente
  and (o.trasporto_mexal is null or o.trasporto_mexal = '{}'::jsonb)
  and o.sincronizzato_mexal_il is null
  and coalesce(c.json_mexal, c.dati_mexal) is not null;

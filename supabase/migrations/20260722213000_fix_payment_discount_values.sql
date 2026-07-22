-- Corregge esclusivamente la normalizzazione delle regole sconto pagamento.
-- Alcune modalità Mexal espongono sconto_esteso = 0 e la percentuale reale in
-- sconto / sconto_pagamento / perc_sconto. Il motore usa sconto_esteso come
-- prima scelta, quindi lo zero impediva il fallback alla percentuale reale.

create or replace function public.mexal_first_payment_discount(payload jsonb)
returns text
language plpgsql
immutable
as $$
declare
  key text;
  value jsonb;
  candidate text;
begin
  if payload is null then
    return null;
  end if;

  if jsonb_typeof(payload) = 'object' then
    foreach key in array array[
      'sconto_pagamento',
      'perc_sconto_pagamento',
      'percentuale_sconto_pagamento',
      'sconto_finanziario',
      'sconto_cassa',
      'perc_sconto',
      'percentuale_sconto',
      'sconto'
    ] loop
      if payload ? key then
        candidate := trim(both '"' from payload -> key #>> '{}');
        if candidate is not null
           and candidate <> ''
           and regexp_replace(candidate, '[% ,.0]', '', 'g') <> '' then
          return candidate;
        end if;
      end if;
    end loop;

    for key, value in select * from jsonb_each(payload) loop
      if jsonb_typeof(value) in ('object', 'array') then
        candidate := public.mexal_first_payment_discount(value);
        if candidate is not null and candidate <> '' then
          return candidate;
        end if;
      end if;
    end loop;
  elsif jsonb_typeof(payload) = 'array' then
    for value in select * from jsonb_array_elements(payload) loop
      candidate := public.mexal_first_payment_discount(value);
      if candidate is not null and candidate <> '' then
        return candidate;
      end if;
    end loop;
  end if;

  return null;
end;
$$;

-- Uniforma i codici numerici, evitando differenze come 010 rispetto a 10.
update public.ordini_regole_pagamento
set codice_pagamento = (codice_pagamento::numeric)::text
where codice_pagamento ~ '^0*[0-9]+$';

-- Recupera la percentuale reale dal JSON Mexal quando i campi normalizzati sono
-- vuoti oppure contengono soltanto zero.
with resolved as (
  select
    id,
    public.mexal_first_payment_discount(dati_mexal) as discount_value
  from public.ordini_regole_pagamento
  where origine = 'MEXAL'
)
update public.ordini_regole_pagamento rules
set
  sconto = coalesce(nullif(resolved.discount_value, ''), rules.sconto),
  sconto_esteso = coalesce(nullif(resolved.discount_value, ''), rules.sconto),
  updated_at = now()
from resolved
where rules.id = resolved.id
  and resolved.discount_value is not null
  and resolved.discount_value <> ''
  and (
    rules.sconto_esteso is null
    or trim(rules.sconto_esteso) = ''
    or regexp_replace(rules.sconto_esteso, '[% ,.0]', '', 'g') = ''
  );

-- Anche per regole manuali o già normalizzate: se sconto_esteso vale zero ma
-- sconto contiene la percentuale, usa sconto come valore effettivo.
update public.ordini_regole_pagamento
set
  sconto_esteso = sconto,
  updated_at = now()
where sconto is not null
  and trim(sconto) <> ''
  and regexp_replace(sconto, '[% ,.0]', '', 'g') <> ''
  and (
    sconto_esteso is null
    or trim(sconto_esteso) = ''
    or regexp_replace(sconto_esteso, '[% ,.0]', '', 'g') = ''
  );

drop function if exists public.mexal_first_payment_discount(jsonb);

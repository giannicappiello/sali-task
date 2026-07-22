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

create or replace function public.normalize_mexal_payment_discount()
returns trigger
language plpgsql
as $$
declare
  resolved_discount text;
begin
  if new.codice_pagamento is not null
     and new.codice_pagamento ~ '^0*[0-9]+$' then
    new.codice_pagamento := (new.codice_pagamento::numeric)::text;
  end if;

  resolved_discount := public.mexal_first_payment_discount(new.dati_mexal);

  if resolved_discount is null or resolved_discount = '' then
    resolved_discount := new.sconto;
  end if;

  if resolved_discount is not null
     and trim(resolved_discount) <> ''
     and regexp_replace(resolved_discount, '[% ,.0]', '', 'g') <> ''
     and (
       new.sconto_esteso is null
       or trim(new.sconto_esteso) = ''
       or regexp_replace(new.sconto_esteso, '[% ,.0]', '', 'g') = ''
     ) then
    new.sconto := resolved_discount;
    new.sconto_esteso := resolved_discount;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_mexal_payment_discount
  on public.ordini_regole_pagamento;

create trigger trg_normalize_mexal_payment_discount
before insert or update on public.ordini_regole_pagamento
for each row
execute function public.normalize_mexal_payment_discount();

-- Corregge immediatamente le righe già presenti.
update public.ordini_regole_pagamento
set codice_pagamento = codice_pagamento;

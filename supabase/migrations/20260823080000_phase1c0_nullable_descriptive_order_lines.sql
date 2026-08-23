-- Fase 1C.0: conserva le righe descrittive OCT senza codici articolo fittizi.
-- Le righe articolo continuano a richiedere un codice articolo reale.

alter table if exists public.ordini_righe
  alter column codice_articolo drop not null;

do $$
begin
  if to_regclass('public.ordini_righe') is not null
     and not exists (
       select 1
       from pg_constraint
       where conrelid = 'public.ordini_righe'::regclass
         and conname = 'ordini_righe_articolo_codice_required_check'
     ) then
    alter table public.ordini_righe
      add constraint ordini_righe_articolo_codice_required_check
      check (riga_descrittiva or codice_articolo is not null);
  end if;
end
$$;

comment on constraint ordini_righe_articolo_codice_required_check
  on public.ordini_righe is
  'Richiede codice_articolo per le righe articolo; consente NULL per righe descrittive/non-articolo.';

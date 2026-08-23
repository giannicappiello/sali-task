-- Fase 1C.0: le righe articolo richiedono quantità positiva; le righe
-- descrittive OCT possono conservare la quantità zero ricevuta da Mexal.

alter table if exists public.ordini_righe
  drop constraint if exists ordini_righe_quantita_check;

alter table public.ordini_righe
  add constraint ordini_righe_quantita_check
  check (
    (not riga_descrittiva and quantita > 0)
    or (riga_descrittiva and quantita >= 0)
  );

comment on constraint ordini_righe_quantita_check
  on public.ordini_righe is
  'Richiede quantità positiva per articoli e consente quantità zero solo alle righe descrittive.';

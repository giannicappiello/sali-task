-- La cache ordini usa il codice articolo Mexal come chiave stabile.
-- Non modifica né elimina righe esistenti e non tocca la foreign key delle righe ordine.
create unique index if not exists ordini_prodotti_cache_codice_articolo_key
  on public.ordini_prodotti_cache (codice_articolo);

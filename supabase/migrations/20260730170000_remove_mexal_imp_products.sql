-- Gli impianti Workspace sono composizioni locali e non articoli Mexal IMP*.
-- Rimuove prima gli eventuali componenti collegati, quindi entrambe le cache.
delete from public.ordini_impianti_componenti
where upper(trim(codice_articolo)) like 'IMP%';

delete from public.ordini_prodotti_cache
where upper(trim(codice_articolo)) like 'IMP%';

delete from public.prodotti
where upper(trim(coalesce(codice_mexal, codice, ''))) like 'IMP%';

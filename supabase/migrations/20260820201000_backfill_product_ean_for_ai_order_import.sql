begin;

update public.ordini_prodotti_cache as cache
set ean = products.ean
from public.prodotti as products
where products.codice_mexal = cache.codice_articolo
  and nullif(btrim(products.ean), '') is not null
  and cache.ean is distinct from products.ean;

commit;

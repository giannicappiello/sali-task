begin;

-- Le view espongono esclusivamente codici già filtrati dal perimetro cliente.
-- L'esecuzione con i privilegi del proprietario consente a OrdiniPrivate di
-- leggere i dati prodotto necessari senza assegnare al cliente il modulo
-- Prodotti né ampliare le policy delle tabelle sorgenti.
create or replace view public.workspace_customer_orderable_products
with (security_barrier = true, security_invoker = false)
as
  select product.*
  from public.prodotti product
  join public.workspace_customer_article_codes linked
    on linked.article_code = upper(btrim(coalesce(product.codice_mexal, product.codice)));

create or replace view public.workspace_customer_orderable_product_economics
with (security_barrier = true, security_invoker = false)
as
  select cache.*
  from public.ordini_prodotti_cache cache
  join public.workspace_customer_article_codes linked
    on linked.article_code = upper(btrim(cache.codice_articolo));

revoke all on table public.workspace_customer_orderable_products from public, anon;
revoke all on table public.workspace_customer_orderable_product_economics from public, anon;
grant select on table public.workspace_customer_orderable_products to authenticated, service_role;
grant select on table public.workspace_customer_orderable_product_economics to authenticated, service_role;

comment on view public.workspace_customer_orderable_products is
  'Prodotti ordinabili già associati al cliente autenticato; ponte RLS limitato alla view filtrata.';
comment on view public.workspace_customer_orderable_product_economics is
  'Dati economici dei soli prodotti associati al cliente autenticato; nessun accesso diretto alla cache completa.';

commit;

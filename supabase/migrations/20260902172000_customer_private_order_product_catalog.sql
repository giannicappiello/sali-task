begin;

-- Catalogo articoli collegati al cliente autenticato attraverso il suo storico
-- ordini/fatture. Le view sono security_invoker: non aggirano le RLS esistenti.
create or replace view public.workspace_customer_article_codes
with (security_invoker = true)
as
  select distinct upper(btrim(line.codice_articolo)) as article_code
  from public.ordini_testate header
  join public.ordini_righe line on line.ordine_id = header.id
  where public.workspace_current_customer_code() is not null
    and public.workspace_customer_data_visible(header.codice_cliente)
    and nullif(btrim(line.codice_articolo), '') is not null
  union
  select distinct upper(btrim(line.codice_articolo)) as article_code
  from public.mexal_fatture_vendita invoice
  join public.mexal_fatture_vendita_righe line on line.fattura_id = invoice.id
  where public.workspace_current_customer_code() is not null
    and public.workspace_customer_data_visible(invoice.codice_cliente)
    and nullif(btrim(line.codice_articolo), '') is not null;

create or replace view public.workspace_customer_orderable_products
with (security_invoker = true)
as
  select product.*
  from public.prodotti product
  join public.workspace_customer_article_codes linked
    on linked.article_code = upper(btrim(coalesce(product.codice_mexal, product.codice)));

create or replace view public.workspace_customer_orderable_product_economics
with (security_invoker = true)
as
  select cache.*
  from public.ordini_prodotti_cache cache
  join public.workspace_customer_article_codes linked
    on linked.article_code = upper(btrim(cache.codice_articolo));

revoke all on table public.workspace_customer_article_codes from public, anon;
revoke all on table public.workspace_customer_orderable_products from public, anon;
revoke all on table public.workspace_customer_orderable_product_economics from public, anon;
grant select on table public.workspace_customer_article_codes to authenticated, service_role;
grant select on table public.workspace_customer_orderable_products to authenticated, service_role;
grant select on table public.workspace_customer_orderable_product_economics to authenticated, service_role;

comment on view public.workspace_customer_article_codes is
  'Codici articolo associati al cliente autenticato tramite il proprio storico ordini e fatture.';
comment on view public.workspace_customer_orderable_products is
  'Prodotti ordinabili dal cliente autenticato, filtrati server-side sul proprio storico.';
comment on view public.workspace_customer_orderable_product_economics is
  'Dati economici dei soli prodotti ordinabili dal cliente autenticato.';

commit;

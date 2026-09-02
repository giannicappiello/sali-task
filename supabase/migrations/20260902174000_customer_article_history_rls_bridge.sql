begin;

-- La view ricava il cliente esclusivamente dalla sessione autenticata e non
-- accetta codici cliente in input. Il ponte con privilegi del proprietario è
-- necessario per leggere le righe storiche senza assegnare al portale cliente
-- i permessi diretti dei moduli Ordini, Fatture o Prodotti.
create or replace view public.workspace_customer_article_codes
with (security_barrier = true, security_invoker = false)
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

revoke all on table public.workspace_customer_article_codes from public, anon;
grant select on table public.workspace_customer_article_codes to authenticated, service_role;

comment on view public.workspace_customer_article_codes is
  'Codici articolo dello storico del solo cliente autenticato; ponte RLS senza parametro cliente manipolabile.';

commit;

-- PR #42: allineamento economico Workspace/Mexal.
-- I campi sulle righe sono snapshot storici: non devono cambiare quando varia il prodotto.

alter table if exists public.prodotti
  add column if not exists prezzo_listino numeric(14,6),
  add column if not exists prezzo_listino_ivato numeric(14,6),
  add column if not exists codice_iva_mexal text,
  add column if not exists aliquota_iva numeric(7,4),
  add column if not exists descrizione_iva text;

alter table if exists public.ordini_righe
  add column if not exists prezzo_listino numeric(14,6),
  add column if not exists codice_iva_mexal text,
  add column if not exists aliquota_iva numeric(7,4),
  add column if not exists imponibile_riga numeric(14,2),
  add column if not exists iva_riga numeric(14,2),
  add column if not exists totale_riga numeric(14,2);

alter table if exists public.ordini_testate
  add column if not exists totale_imponibile numeric(14,2),
  add column if not exists totale_iva numeric(14,2),
  add column if not exists totale_documento numeric(14,2),
  add column if not exists totali_mexal_verificati boolean not null default false,
  add column if not exists differenza_iva_mexal numeric(14,2),
  add column if not exists differenza_totale_mexal numeric(14,2),
  add column if not exists totali_mexal_verificati_at timestamptz;

comment on column public.prodotti.prezzo_listino is 'Prezzo di listino Mexal, prima degli sconti commerciali.';
comment on column public.prodotti.codice_iva_mexal is 'Codice IVA restituito dall’anagrafica articolo Mexal.';
comment on column public.ordini_righe.prezzo_listino is 'Snapshot del prezzo di listino inviato a Mexal.';
comment on column public.ordini_righe.aliquota_iva is 'Snapshot dell’aliquota IVA applicata alla riga.';
comment on column public.ordini_testate.totali_mexal_verificati is 'Vero solo dopo confronto con i totali restituiti da Mexal.';

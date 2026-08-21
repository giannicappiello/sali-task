begin;

alter table public.mexal_fatture_vendita
  drop constraint if exists mexal_fatture_vendita_tipo_documento_check;

alter table public.mexal_fatture_vendita
  add constraint mexal_fatture_vendita_tipo_documento_check
  check (
    sigla = 'FT'
    or (sigla in ('CO', 'OC') and cod_modulo = 'X')
  );

alter table public.mexal_fatture_vendita
  alter column data_documento drop not null;

alter table public.mexal_fatture_vendita
  add column if not exists causale_magazzino_codice text,
  add column if not exists causale_magazzino_descrizione text;

alter table public.ordini_documenti_mexal
  add column if not exists causale_magazzino_codice text,
  add column if not exists causale_magazzino_descrizione text,
  add column if not exists dati_mexal jsonb not null default '{}'::jsonb;

update public.mexal_fatture_sync_stato
set next_cursor = null,
    ciclo_iniziato_il = null,
    fte_trovate = false,
    pagine_vuote_dopo_fte = 0,
    aggiornato_il = now()
where id = 1;

commit;

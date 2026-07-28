begin;

alter table public.mexal_fatture_vendita
  drop constraint if exists mexal_fatture_vendita_sigla_check;
alter table public.mexal_fatture_vendita
  drop constraint if exists mexal_fatture_vendita_cod_modulo_check;
alter table public.mexal_fatture_vendita
  drop constraint if exists mexal_fatture_vendita_sigla_serie_numero_codice_cliente_key;

alter table public.mexal_fatture_vendita
  add constraint mexal_fatture_vendita_tipo_documento_check
  check (
    (sigla = 'FT' and cod_modulo in ('E', 'S'))
    or (sigla = 'CO' and cod_modulo = 'X')
  );

alter table public.mexal_fatture_vendita
  add constraint mexal_fatture_vendita_documento_key
  unique (sigla, cod_modulo, serie, numero, codice_cliente);

update public.mexal_fatture_sync_stato
set next_cursor = null,
    fte_trovate = false,
    pagine_vuote_dopo_fte = 0,
    ciclo_iniziato_il = null,
    aggiornato_il = now()
where id = 1;

commit;

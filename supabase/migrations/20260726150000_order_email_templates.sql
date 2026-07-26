begin;

alter table public.ordini_moduli_configurazione
  add column if not exists email_cliente_oggetto_template text,
  add column if not exists email_cliente_corpo_template text,
  add column if not exists email_agente_oggetto_template text,
  add column if not exists email_agente_corpo_template text,
  add column if not exists email_backoffice_oggetto_template text,
  add column if not exists email_backoffice_corpo_template text;

update public.ordini_moduli_configurazione
set
  email_cliente_oggetto_template = coalesce(
    nullif(btrim(email_cliente_oggetto_template), ''),
    'Conferma ordine {numero_ordine}'
  ),
  email_cliente_corpo_template = coalesce(
    nullif(btrim(email_cliente_corpo_template), ''),
    E'Gentile {cliente},\n\nin allegato trova la conferma dell''ordine {numero_ordine} del {data}, per un totale di {totale}.\n\nCordiali saluti.'
  ),
  email_agente_oggetto_template = coalesce(
    nullif(btrim(email_agente_oggetto_template), ''),
    'Conferma ordine {numero_ordine} - {cliente}'
  ),
  email_agente_corpo_template = coalesce(
    nullif(btrim(email_agente_corpo_template), ''),
    E'Ciao {agente},\n\nin allegato trovi la conferma dell''ordine {numero_ordine} del {data} per il cliente {cliente}, per un totale di {totale}.'
  ),
  email_backoffice_oggetto_template = coalesce(
    nullif(btrim(email_backoffice_oggetto_template), ''),
    'Ordine {numero_ordine} - {cliente}'
  ),
  email_backoffice_corpo_template = coalesce(
    nullif(btrim(email_backoffice_corpo_template), ''),
    E'È stato confermato l''ordine {numero_ordine} del {data} per il cliente {cliente}.\nAgente: {agente}\nTotale: {totale}.'
  );

alter table public.ordini_moduli_configurazione
  alter column email_cliente_oggetto_template
    set default 'Conferma ordine {numero_ordine}',
  alter column email_cliente_oggetto_template set not null,
  alter column email_cliente_corpo_template
    set default E'Gentile {cliente},\n\nin allegato trova la conferma dell''ordine {numero_ordine} del {data}, per un totale di {totale}.\n\nCordiali saluti.',
  alter column email_cliente_corpo_template set not null,
  alter column email_agente_oggetto_template
    set default 'Conferma ordine {numero_ordine} - {cliente}',
  alter column email_agente_oggetto_template set not null,
  alter column email_agente_corpo_template
    set default E'Ciao {agente},\n\nin allegato trovi la conferma dell''ordine {numero_ordine} del {data} per il cliente {cliente}, per un totale di {totale}.',
  alter column email_agente_corpo_template set not null,
  alter column email_backoffice_oggetto_template
    set default 'Ordine {numero_ordine} - {cliente}',
  alter column email_backoffice_oggetto_template set not null,
  alter column email_backoffice_corpo_template
    set default E'È stato confermato l''ordine {numero_ordine} del {data} per il cliente {cliente}.\nAgente: {agente}\nTotale: {totale}.',
  alter column email_backoffice_corpo_template set not null;

alter table public.ordini_moduli_configurazione
  drop constraint if exists ordini_moduli_config_email_template_lengths_check;

alter table public.ordini_moduli_configurazione
  add constraint ordini_moduli_config_email_template_lengths_check
  check (
    char_length(btrim(email_cliente_oggetto_template)) between 1 and 255
    and char_length(btrim(email_agente_oggetto_template)) between 1 and 255
    and char_length(btrim(email_backoffice_oggetto_template)) between 1 and 255
    and char_length(btrim(email_cliente_corpo_template)) between 1 and 10000
    and char_length(btrim(email_agente_corpo_template)) between 1 and 10000
    and char_length(btrim(email_backoffice_corpo_template)) between 1 and 10000
  );

alter table public.ordini_email_invio
  add column if not exists corpo text;

commit;

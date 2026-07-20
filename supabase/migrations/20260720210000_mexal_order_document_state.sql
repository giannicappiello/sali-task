-- Persist document-level state so retries reconcile each OCM/OCX/OCI independently.
alter table public.ordini_configurazione_documenti
  add column if not exists serie_oci text,
  add column if not exists id_magazzino integer;

create table if not exists public.ordini_documenti_mexal (
  ordine_id uuid not null references public.ordini_testate(id) on delete cascade,
  tipo_documento text not null check (tipo_documento in ('OCM','OCX','OCI')),
  stato text not null check (stato in ('pending','created','reconciled','failed')) default 'pending',
  sigla text not null default 'OC', serie integer, numero text, cod_modulo text not null,
  tentativi integer not null default 0, errore text, risposta jsonb not null default '{}'::jsonb,
  pdf_stato text not null default 'not_requested' check (pdf_stato in ('not_requested','pending','available','failed')),
  pdf_errore text, creato_il timestamptz, verificato_il timestamptz, aggiornato_il timestamptz not null default now(),
  primary key (ordine_id, tipo_documento)
);

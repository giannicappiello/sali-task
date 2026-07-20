-- OCI is a first-class Mexal customer-order document. Existing OCM/OCX rows remain untouched.
alter table if exists public.ordini_testate
  add column if not exists numero_oci text;

alter table if exists public.ordini_righe
  add column if not exists quantita_oci numeric not null default 0;

alter table if exists public.ordini_sync_mexal_log
  drop constraint if exists ordini_sync_mexal_log_tipo_documento_check;
alter table if exists public.ordini_sync_mexal_log
  add constraint ordini_sync_mexal_log_tipo_documento_check check (tipo_documento in ('OCM', 'OCX', 'OCI'));

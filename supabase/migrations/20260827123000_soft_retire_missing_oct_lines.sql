begin;

alter table public.ordini_righe
  add column if not exists mexal_attiva boolean not null default true,
  add column if not exists mexal_ritirata_il timestamptz;

create index if not exists idx_ordini_righe_mexal_attive
  on public.ordini_righe (ordine_id, mexal_attiva, mexal_posizione);

comment on column public.ordini_righe.mexal_attiva is
  'False when the authoritative Mexal OCT no longer contains this position; the row remains for audit and lineage.';
comment on column public.ordini_righe.mexal_ritirata_il is
  'Timestamp when a later authoritative Mexal OCT import observed the line as absent.';

commit;

alter table public.ordini_testate
  add column if not exists tipo_ordine text not null default 'standard';

alter table public.ordini_testate
  drop constraint if exists ordini_testate_tipo_ordine_check;

alter table public.ordini_testate
  add constraint ordini_testate_tipo_ordine_check
  check (tipo_ordine in ('standard', 'prenotazione'));

comment on column public.ordini_testate.tipo_ordine is
  'standard: ripartizione per disponibilita; prenotazione: articoli in OCI senza verifica giacenze, salvo IMP sempre in OCM.';

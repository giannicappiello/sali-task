begin;

-- Alcuni clienti/farmacie Mexal non hanno un agente associato. La bozza deve
-- poter essere salvata senza inventare un codice agente inesistente.
alter table public.ordini_testate
  alter column codice_agente_mexal drop not null;

commit;

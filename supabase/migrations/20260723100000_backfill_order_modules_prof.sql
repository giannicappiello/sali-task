-- Defensive follow-up for installations where modulo_ordini already existed before
-- the PROF/PH migration: no historical order may remain outside ORDINI PROF.
update public.ordini_testate
set modulo_ordini = 'prof'
where modulo_ordini is null or btrim(modulo_ordini) = '' or modulo_ordini not in ('prof', 'ph');

alter table public.ordini_testate
  alter column modulo_ordini set default 'prof';
alter table public.ordini_testate
  alter column modulo_ordini set not null;

-- Ensure both independent configuration records exist even on partially applied deployments.
insert into public.ordini_moduli_configurazione (modulo_ordini, invia_automaticamente_mexal)
values ('prof', true), ('ph', false)
on conflict (modulo_ordini) do nothing;

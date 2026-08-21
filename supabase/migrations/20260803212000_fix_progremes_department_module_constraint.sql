begin;

alter table public.reparti_moduli
  drop constraint if exists reparti_moduli_modulo_check;

alter table public.reparti_moduli
  add constraint reparti_moduli_modulo_check check (
    modulo in (
      'beauty_days',
      'ordini_pr',
      'ordini_ph',
      'prodotti',
      'documenti',
      'progetti',
      'attivita',
      'agenda',
      'messaggi',
      'report',
      'team',
      'integrazioni',
      'progremes'
    )
  );

commit;

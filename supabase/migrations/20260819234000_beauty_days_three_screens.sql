begin;

insert into public.workspace_schermate (
  codice,
  nome,
  descrizione,
  provider,
  percorso,
  chiave_componente,
  protetta,
  attiva,
  ordine,
  metadati,
  ultima_sincronizzazione
)
values
  (
    'beauty.dashboard',
    'Dashboard Beauty Days',
    'Indicatori, risultati, obiettivi e aree di attenzione delle giornate promozionali.',
    'workspace',
    '/farmacie/dashboard',
    'beauty.dashboard',
    false,
    true,
    110,
    '{"required_module":"beauty_days","allowed_page":"dashboard"}'::jsonb,
    now()
  ),
  (
    'beauty.aperture',
    'Aperture e contatti',
    'Richieste di contatto, nuove aperture e relativo stato di avanzamento.',
    'workspace',
    '/farmacie/aperture',
    'beauty.aperture',
    false,
    true,
    120,
    '{"required_module":"beauty_days","allowed_page":"aperture"}'::jsonb,
    now()
  ),
  (
    'beauty.giornate',
    'Giornate promozionali',
    'Pianificazione, gestione e rendicontazione delle giornate Beauty.',
    'workspace',
    '/farmacie/giornate',
    'beauty.giornate',
    false,
    true,
    130,
    '{"required_module":"beauty_days","allowed_page":"giornate"}'::jsonb,
    now()
  )
on conflict (codice) do update set
  nome = excluded.nome,
  descrizione = excluded.descrizione,
  provider = excluded.provider,
  percorso = excluded.percorso,
  chiave_componente = excluded.chiave_componente,
  attiva = excluded.attiva,
  ordine = excluded.ordine,
  metadati = workspace_schermate.metadati || excluded.metadati,
  ultima_sincronizzazione = now();

update public.workspace_moduli_schermate
set predefinita = false
where modulo_codice = 'beauty_days';

insert into public.workspace_moduli_schermate (
  modulo_codice,
  schermata_codice,
  ordine,
  predefinita,
  visibile_menu
)
values
  ('beauty_days', 'beauty.dashboard', 10, true, true),
  ('beauty_days', 'beauty.aperture', 20, false, true),
  ('beauty_days', 'beauty.giornate', 30, false, true)
on conflict (modulo_codice, schermata_codice) do update set
  ordine = excluded.ordine,
  predefinita = excluded.predefinita,
  visibile_menu = excluded.visibile_menu;

update public.workspace_moduli
set
  percorso = '/farmacie/dashboard',
  tipo = 'modulo',
  aggiornato_il = now()
where codice = 'beauty_days';

commit;

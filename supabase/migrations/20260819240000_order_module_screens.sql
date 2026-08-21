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
  ('ordini_pr.dashboard', 'Dashboard Ordini PR', 'Indicatori e riepilogo operativo degli ordini PR.', 'workspace', '/ordini-prof/dashboard', 'orders.pr.dashboard', false, true, 200, '{"required_module":"ordini_pr","allowed_page":"dashboard"}'::jsonb, now()),
  ('ordini_pr.clienti', 'Clienti Ordini PR', 'Clienti disponibili per la gestione degli ordini PR.', 'workspace', '/ordini-prof/clienti', 'orders.pr.customers', false, true, 210, '{"required_module":"ordini_pr","allowed_page":"customers"}'::jsonb, now()),
  ('ordini_pr.ordini', 'Ordini PR', 'Elenco, consultazione e gestione degli ordini PR.', 'workspace', '/ordini-prof/elenco', 'orders.pr.orders', false, true, 220, '{"required_module":"ordini_pr","allowed_page":"orders"}'::jsonb, now()),
  ('ordini_pr.fatture', 'Fatture PR', 'Elenco e consultazione delle fatture PR.', 'workspace', '/ordini-prof/fatture', 'orders.pr.invoices', false, true, 230, '{"required_module":"ordini_pr","allowed_page":"invoices"}'::jsonb, now()),
  ('ordini_ph.dashboard', 'Dashboard Ordini PH', 'Indicatori e riepilogo operativo degli ordini PH.', 'workspace', '/ordini-ph/dashboard', 'orders.ph.dashboard', false, true, 240, '{"required_module":"ordini_ph","allowed_page":"dashboard"}'::jsonb, now()),
  ('ordini_ph.clienti', 'Clienti Ordini PH', 'Clienti disponibili per la gestione degli ordini PH.', 'workspace', '/ordini-ph/clienti', 'orders.ph.customers', false, true, 250, '{"required_module":"ordini_ph","allowed_page":"customers"}'::jsonb, now()),
  ('ordini_ph.ordini', 'Ordini PH', 'Elenco, consultazione e gestione degli ordini PH.', 'workspace', '/ordini-ph/elenco', 'orders.ph.orders', false, true, 260, '{"required_module":"ordini_ph","allowed_page":"orders"}'::jsonb, now()),
  ('ordini_ph.fatture', 'Fatture PH', 'Elenco e consultazione delle fatture PH.', 'workspace', '/ordini-ph/fatture', 'orders.ph.invoices', false, true, 270, '{"required_module":"ordini_ph","allowed_page":"invoices"}'::jsonb, now())
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

insert into public.workspace_moduli_schermate (
  modulo_codice,
  schermata_codice,
  ordine,
  predefinita,
  visibile_menu
)
values
  ('ordini_pr', 'ordini_pr.dashboard', 10, false, true),
  ('ordini_pr', 'ordini_pr.clienti', 20, false, true),
  ('ordini_pr', 'ordini_pr.ordini', 30, false, true),
  ('ordini_pr', 'ordini_pr.fatture', 40, false, true),
  ('ordini_ph', 'ordini_ph.dashboard', 10, false, true),
  ('ordini_ph', 'ordini_ph.clienti', 20, false, true),
  ('ordini_ph', 'ordini_ph.ordini', 30, false, true),
  ('ordini_ph', 'ordini_ph.fatture', 40, false, true)
on conflict (modulo_codice, schermata_codice) do update set
  ordine = excluded.ordine,
  predefinita = workspace_moduli_schermate.predefinita,
  visibile_menu = true;

update public.workspace_moduli modules
set
  tipo = 'contenitore',
  percorso = '/moduli/' || modules.codice,
  aggiornato_il = now()
where modules.codice in ('ordini_pr', 'ordini_ph')
  and not exists (
    select 1
    from public.workspace_moduli_schermate links
    where links.modulo_codice = modules.codice
      and links.predefinita
  );

commit;

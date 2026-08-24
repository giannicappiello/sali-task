begin;

insert into public.workspace_moduli (
  codice,
  nome,
  descrizione,
  tipo,
  area,
  percorso,
  provider,
  sempre_disponibile,
  assegnabile_reparto,
  livello_self_service,
  dipendenze,
  protetto,
  configurabile_ruolo,
  mostra_menu,
  attivo,
  ordine,
  icona,
  aggiornato_il
)
select
  'manuali_uso',
  'Manuali d''uso',
  'Manuali d''uso e guide operative aziendali',
  'modulo',
  'documentale',
  '/manuali-uso',
  'workspace',
  documenti.sempre_disponibile,
  documenti.assegnabile_reparto,
  documenti.livello_self_service,
  documenti.dipendenze,
  false,
  documenti.configurabile_ruolo,
  true,
  true,
  documenti.ordine + 1,
  'book-open',
  now()
from public.workspace_moduli documenti
where documenti.codice = 'documenti'
on conflict (codice) do update set
  nome = excluded.nome,
  descrizione = excluded.descrizione,
  tipo = excluded.tipo,
  area = excluded.area,
  percorso = excluded.percorso,
  provider = excluded.provider,
  sempre_disponibile = excluded.sempre_disponibile,
  assegnabile_reparto = excluded.assegnabile_reparto,
  livello_self_service = excluded.livello_self_service,
  dipendenze = excluded.dipendenze,
  protetto = false,
  configurabile_ruolo = excluded.configurabile_ruolo,
  mostra_menu = true,
  attivo = true,
  ordine = excluded.ordine,
  icona = excluded.icona,
  aggiornato_il = now();

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
  area,
  icona,
  metadati,
  ultima_sincronizzazione
)
values (
  'manuali_uso',
  'Manuali d''uso',
  'Manuali d''uso e guide operative aziendali',
  'workspace',
  '/manuali-uso',
  'documentation.manuals',
  false,
  true,
  71,
  'documentale',
  'book-open',
  '{}'::jsonb,
  now()
)
on conflict (codice) do update set
  nome = excluded.nome,
  descrizione = excluded.descrizione,
  provider = excluded.provider,
  percorso = excluded.percorso,
  chiave_componente = excluded.chiave_componente,
  attiva = true,
  ordine = excluded.ordine,
  area = excluded.area,
  icona = excluded.icona,
  ultima_sincronizzazione = now();

insert into public.workspace_moduli_schermate (
  modulo_codice,
  schermata_codice,
  ordine,
  predefinita,
  visibile_menu
)
values ('manuali_uso', 'manuali_uso', 10, true, true)
on conflict (modulo_codice, schermata_codice) do update set
  ordine = excluded.ordine,
  predefinita = true,
  visibile_menu = true;

insert into public.workspace_menu_voci (
  codice,
  nome,
  descrizione,
  icona,
  ordine,
  attiva,
  aggiornata_il
)
select
  'manuali_uso',
  'Manuali d''uso',
  'Manuali d''uso e guide operative aziendali',
  'book-open',
  coalesce((
    select documenti_menu.ordine + 1
    from public.workspace_menu_voci documenti_menu
    where documenti_menu.codice = 'documenti'
  ), 71),
  true,
  now()
on conflict (codice) do update set
  nome = excluded.nome,
  descrizione = excluded.descrizione,
  icona = excluded.icona,
  ordine = excluded.ordine,
  attiva = true,
  aggiornata_il = now();

insert into public.workspace_menu_moduli (
  voce_codice,
  modulo_codice,
  ordine
)
values ('manuali_uso', 'manuali_uso', 10)
on conflict (voce_codice, modulo_codice) do update set
  ordine = excluded.ordine;

insert into public.ruoli_moduli (
  ruolo_id,
  modulo,
  livello_accesso,
  aggiornato_il
)
select
  ruolo_id,
  'manuali_uso',
  livello_accesso,
  now()
from public.ruoli_moduli
where modulo = 'documenti'
on conflict (ruolo_id, modulo) do nothing;

insert into public.reparti_moduli (
  reparto_id,
  modulo,
  creato_il
)
select
  reparto_id,
  'manuali_uso',
  now()
from public.reparti_moduli
where modulo = 'documenti'
on conflict (reparto_id, modulo) do nothing;

insert into public.workspace_eccezioni_utente (
  utente_id,
  ambito,
  codice,
  decisione,
  livello_accesso,
  motivazione,
  valida_fino_a,
  creata_da,
  creata_il,
  aggiornata_il
)
select
  utente_id,
  ambito,
  'manuali_uso',
  decisione,
  livello_accesso,
  motivazione,
  valida_fino_a,
  creata_da,
  now(),
  now()
from public.workspace_eccezioni_utente
where ambito = 'modulo'
  and codice = 'documenti'
on conflict (utente_id, ambito, codice) do nothing;

commit;

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
  prima_sincronizzazione,
  ultima_sincronizzazione
)
select
  case
    when modulo.codice like 'progremes.%' then modulo.codice
    else 'progremes.' || modulo.codice
  end,
  modulo.nome,
  modulo.descrizione,
  'progremes',
  '/progremes',
  null,
  false,
  modulo.attivo,
  modulo.ordine,
  jsonb_build_object(
    'external_code', modulo.codice,
    'external_route', modulo.percorso,
    'catalog_source', 'existing_progremes_modules'
  ),
  modulo.prima_sincronizzazione,
  modulo.ultima_sincronizzazione
from public.progremes_moduli modulo
on conflict (codice) do update set
  nome = excluded.nome,
  descrizione = excluded.descrizione,
  provider = 'progremes',
  attiva = excluded.attiva,
  ordine = excluded.ordine,
  metadati = excluded.metadati,
  ultima_sincronizzazione = excluded.ultima_sincronizzazione;

commit;

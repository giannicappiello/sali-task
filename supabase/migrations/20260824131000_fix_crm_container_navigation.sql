begin;

-- Il menu Workspace usa il percorso del modulo catalogato. Manteniamo il
-- contenitore CRM come unica destinazione della voce principale e rendiamo
-- esplicite nel catalogo le aree che ne determinano visibilità e contenuto.
update public.workspace_moduli
set tipo = 'contenitore',
    area = 'crm',
    percorso = '/crm',
    provider = 'workspace',
    mostra_menu = true,
    attivo = true,
    icona = 'briefcase',
    dipendenze_alternative = array['crm_conto_terzi','crm_b2b','crm_online','crm_ai'],
    aggiornato_il = now()
where codice = 'crm';

insert into public.workspace_menu_voci (codice,nome,descrizione,icona,ordine,attiva)
values ('crm','CRM','CRM Platform AI','briefcase',65,true)
on conflict (codice) do update set
  nome = excluded.nome,
  descrizione = excluded.descrizione,
  icona = excluded.icona,
  ordine = excluded.ordine,
  attiva = true;

delete from public.workspace_menu_moduli
where voce_codice = 'crm' and modulo_codice <> 'crm';

insert into public.workspace_menu_moduli (voce_codice,modulo_codice,ordine)
values ('crm','crm',10)
on conflict (voce_codice,modulo_codice) do update set ordine = excluded.ordine;

update public.workspace_schermate
set nome = 'Panoramica CRM',
    descrizione = 'Accesso alle sole aree CRM autorizzate.',
    provider = 'workspace',
    percorso = '/crm',
    chiave_componente = 'crm.overview',
    attiva = true,
    area = 'crm',
    icona = 'briefcase',
    ultima_sincronizzazione = now()
where codice = 'crm.dashboard';

update public.workspace_moduli_schermate
set predefinita = false
where modulo_codice = 'crm' and schermata_codice <> 'crm.dashboard';

insert into public.workspace_moduli_schermate
  (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values ('crm','crm.dashboard',10,true,true)
on conflict (modulo_codice,schermata_codice) do update set
  ordine = excluded.ordine,
  predefinita = excluded.predefinita,
  visibile_menu = excluded.visibile_menu;

-- Matrice canonica condivisa con src/modules/crm/crmRouteCatalog.js. La
-- migrazione riallinea anche cataloghi gia modificati manualmente.
with canonical_crm_routes(codice,percorso) as (values
  ('crm.dashboard','/crm'),
  ('crm.conto_terzi.dashboard','/crm/conto-terzi'),
  ('crm.conto_terzi.clienti','/crm/conto-terzi/clienti'),
  ('crm.conto_terzi.cliente','/crm/conto-terzi/clienti/:id'),
  ('crm.conto_terzi.pipeline','/crm/conto-terzi/pipeline'),
  ('crm.conto_terzi.brief','/crm/conto-terzi/brief'),
  ('crm.b2b.dashboard','/crm/b2b'),
  ('crm.b2b.clienti','/crm/b2b/clienti'),
  ('crm.b2b.cliente','/crm/b2b/clienti/:id'),
  ('crm.b2b.pipeline','/crm/b2b/pipeline'),
  ('crm.online.dashboard','/crm/online'),
  ('crm.online.digital','/crm/online/digital'),
  ('crm.online.ecommerce','/crm/online/ecommerce'),
  ('crm.online.mailing','/crm/online/mailing'),
  ('crm.online.amazon','/crm/online/amazon'),
  ('crm.online.adv','/crm/online/adv'),
  ('crm.online.clienti','/crm/online/clienti'),
  ('crm.online.cliente','/crm/online/clienti/:id'),
  ('crm.online.campaigns','/crm/online/campagne'),
  ('crm.online.creators_v2','/crm/online/creators'),
  ('crm.online.journey_v2','/crm/online/journey'),
  ('crm.online.analytics','/crm/online/analytics'),
  ('crm.online.ai','/crm/online/ai'),
  ('crm.ai','/crm/ai')
)
update public.workspace_schermate schermata
set percorso = route.percorso,
    provider = 'workspace',
    attiva = true,
    area = 'crm',
    ultima_sincronizzazione = now()
from canonical_crm_routes route
where schermata.codice = route.codice;

insert into public.workspace_schermate
  (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,icona,metadati,ultima_sincronizzazione)
values
  ('crm.online.cliente','Scheda Cliente Online','Profilo cliente, acquisti, consensi e customer journey.','workspace','/crm/online/clienti/:id','crm.account',false,true,415,'crm','users','{}',now())
on conflict (codice) do update set
  nome = excluded.nome,
  descrizione = excluded.descrizione,
  provider = excluded.provider,
  percorso = excluded.percorso,
  chiave_componente = excluded.chiave_componente,
  attiva = true,
  area = excluded.area,
  icona = excluded.icona,
  ultima_sincronizzazione = now();

insert into public.workspace_moduli_schermate
  (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values ('crm_online','crm.online.cliente',35,false,false)
on conflict (modulo_codice,schermata_codice) do update set
  ordine = excluded.ordine,
  predefinita = false,
  visibile_menu = false;

-- Le vecchie URL restano alias React, ma non sono piu schermate canoniche.
update public.workspace_schermate
set attiva = false, ultima_sincronizzazione = now()
where codice in ('crm.online.creators','crm.online.customer_journey');
delete from public.workspace_moduli_schermate
where schermata_codice in ('crm.online.creators','crm.online.customer_journey');

update public.workspace_moduli
set mostra_menu = false, aggiornato_il = now()
where codice like 'crm_%';

update public.workspace_moduli_schermate
set predefinita = false
where modulo_codice in ('crm','crm_conto_terzi','crm_b2b','crm_online','crm_ai');
update public.workspace_moduli_schermate collegamento
set predefinita = true
from (values
  ('crm','crm.dashboard'),
  ('crm_conto_terzi','crm.conto_terzi.dashboard'),
  ('crm_b2b','crm.b2b.dashboard'),
  ('crm_online','crm.online.dashboard'),
  ('crm_ai','crm.ai')
) predefinita(modulo_codice,schermata_codice)
where collegamento.modulo_codice = predefinita.modulo_codice
  and collegamento.schermata_codice = predefinita.schermata_codice;

commit;

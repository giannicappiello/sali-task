begin;

-- Catalogo additivo: assegna a ogni esperienza operativa CRM una testata
-- Workspace distinta. Non modifica clienti, opportunità, attività o progetti.
insert into public.workspace_schermate
  (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,icona,metadati,ultima_sincronizzazione)
values
  ('crm.conto_terzi.opportunita','Opportunità PRIVATE','Elenco opportunità per lo sviluppo prodotto e il percorso cliente.','workspace','/crm/conto-terzi/opportunita','crm.pipeline',false,true,24,'crm','workflow','{}',now()),
  ('crm.conto_terzi.attivita','Attività PRIVATE','Attività commerciali e tecniche collegate a cliente e opportunità.','workspace','/crm/conto-terzi/attivita','crm.activities',false,true,25,'crm','clipboard','{}',now()),
  ('crm.conto_terzi.sviluppi','Campioni e sviluppi','Campionature, formule e preventivi collegati al percorso PRIVATE.','workspace','/crm/conto-terzi/sviluppi','crm.developments',false,true,26,'crm','flask','{}',now()),
  ('crm.conto_terzi.progetti','Progetti collegati','Collegamenti controllati fra opportunità CRM e progetti Workspace.','workspace','/crm/conto-terzi/progetti','crm.projects',false,true,27,'crm','folder-kanban','{}',now()),
  ('crm.conto_terzi.analisi','Analisi PRIVATE','Indicatori commerciali e operativi del CRM PRIVATE.','workspace','/crm/conto-terzi/analisi','crm.analytics',false,true,28,'crm','chart','{}',now()),
  ('crm.b2b.attivita','Attività B2B','Attività di acquisizione, follow-up e sviluppo cliente B2B.','workspace','/crm/b2b/attivita','crm.activities',false,true,34,'crm','clipboard','{}',now()),
  ('crm.b2b.da_seguire','Clienti da seguire','Priorità commerciali B2B derivate dai dati reali di relazione e vendita.','workspace','/crm/b2b/da-seguire','crm.follow_up',false,true,35,'crm','users','{}',now()),
  ('crm.b2b.riordini','Riordini e opportunità commerciali','Clienti acquisiti ordinati per ultimo acquisto, frequenza e valore.','workspace','/crm/b2b/riordini','crm.reorders',false,true,36,'crm','shopping-bag','{}',now()),
  ('crm.b2b.beautydays','BeautyDays','Giornate in farmacia e relativo impatto commerciale.','workspace','/crm/b2b/beautydays','crm.beautydays',false,true,37,'crm','store','{}',now()),
  ('crm.b2b.analisi','Analisi B2B','Indicatori di acquisizione, riordino e sviluppo cliente B2B.','workspace','/crm/b2b/analisi','crm.analytics',false,true,38,'crm','chart','{}',now())
on conflict (codice) do update set
  nome=excluded.nome,
  descrizione=excluded.descrizione,
  provider=excluded.provider,
  percorso=excluded.percorso,
  chiave_componente=excluded.chiave_componente,
  protetta=excluded.protetta,
  attiva=true,
  ordine=excluded.ordine,
  area=excluded.area,
  icona=excluded.icona,
  ultima_sincronizzazione=now();

insert into public.workspace_moduli_schermate
  (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values
  ('crm_conto_terzi','crm.conto_terzi.opportunita',24,false,true),
  ('crm_conto_terzi','crm.conto_terzi.attivita',25,false,true),
  ('crm_conto_terzi','crm.conto_terzi.sviluppi',26,false,true),
  ('crm_conto_terzi','crm.conto_terzi.progetti',27,false,true),
  ('crm_conto_terzi','crm.conto_terzi.analisi',28,false,true),
  ('crm_b2b','crm.b2b.attivita',34,false,true),
  ('crm_b2b','crm.b2b.da_seguire',35,false,true),
  ('crm_b2b','crm.b2b.riordini',36,false,true),
  ('crm_b2b','crm.b2b.beautydays',37,false,true),
  ('crm_b2b','crm.b2b.analisi',38,false,true)
on conflict (modulo_codice,schermata_codice) do update set
  ordine=excluded.ordine,
  predefinita=excluded.predefinita,
  visibile_menu=excluded.visibile_menu;

commit;

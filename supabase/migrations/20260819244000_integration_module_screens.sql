begin;

insert into public.workspace_schermate (
  codice,nome,descrizione,provider,percorso,chiave_componente,
  protetta,attiva,ordine,metadati,ultima_sincronizzazione
)
values
  ('integrazioni.mexal','Mexal ERP','Sincronizzazione di clienti, prodotti, condizioni commerciali, giacenze, ordini e fatture.','workspace','/integrations/mexal','integrations.mexal',false,true,910,'{"required_permissions":["integrations.configure","integrations.sync.clients","integrations.sync.agents","integrations.sync.products","integrations.sync.product_categories","integrations.sync.commercial_conditions","integrations.sync.stocks","integrations.sync.list_price_commissions","integrations.sync.orders","integrations.sync.sales_invoices"]}'::jsonb,now()),
  ('integrazioni.mexal_agenti','Agenti Mexal','Importazione, associazione e controllo degli agenti provenienti da Mexal.','workspace','/integrations/mexal/agenti','integrations.mexal_agents',false,true,920,'{"required_permissions":["integrations.configure","integrations.sync.agents"]}'::jsonb,now()),
  ('integrazioni.serie_documenti','Serie documenti','Configurazione e sincronizzazione delle serie documentali utilizzate dagli ordini.','workspace','/integrations/mexal/serie-documenti','integrations.document_series',false,true,930,'{"required_permissions":["integrations.configure","integrations.sync.document_series"]}'::jsonb,now()),
  ('integrazioni.ordini_pr','Configurazione Ordini PR','Invio Mexal, serie documenti, automazioni e destinatari email degli Ordini PR.','workspace','/integrations/orders/prof','integrations.orders_pr',false,true,940,'{"required_permissions":["integrations.configure"]}'::jsonb,now()),
  ('integrazioni.ordini_ph','Configurazione Ordini PH','Invio Mexal, serie documenti, automazioni e destinatari email degli Ordini PH.','workspace','/integrations/orders/ph','integrations.orders_ph',false,true,950,'{"required_permissions":["integrations.configure"]}'::jsonb,now()),
  ('integrazioni.documentale','Documentale','Sincronizzazione NAS, sezioni documentali e classificazione dei file.','workspace','/integrations/documentale','integrations.documents',false,true,960,'{"required_permissions":["integrations.configure","integrations.sync.documents"]}'::jsonb,now()),
  ('integrazioni.progremes','ProgreMES','Sincronizzazione del catalogo moduli MES e servizi di collegamento con il Workspace.','workspace','/integrations/progremes','integrations.progremes',false,true,970,'{"required_permissions":["integrations.configure","integrations.sync.progremes_modules"]}'::jsonb,now())
on conflict (codice) do update set
  nome=excluded.nome,
  descrizione=excluded.descrizione,
  provider=excluded.provider,
  percorso=excluded.percorso,
  chiave_componente=excluded.chiave_componente,
  attiva=excluded.attiva,
  ordine=excluded.ordine,
  metadati=workspace_schermate.metadati || excluded.metadati,
  ultima_sincronizzazione=excluded.ultima_sincronizzazione;

update public.workspace_schermate
set metadati=metadati || '{"kind":"topic"}'::jsonb,
    ultima_sincronizzazione=now()
where codice='integrazioni';

update public.workspace_moduli
set tipo='contenitore',
    percorso='/integrations',
    aggiornato_il=now()
where codice='integrazioni';

update public.workspace_moduli_schermate
set predefinita=false,
    visibile_menu=false
where modulo_codice='integrazioni'
  and schermata_codice='integrazioni';

insert into public.workspace_moduli_schermate (
  modulo_codice,schermata_codice,ordine,predefinita,visibile_menu
)
values
  ('integrazioni','integrazioni.mexal',10,false,true),
  ('integrazioni','integrazioni.mexal_agenti',20,false,true),
  ('integrazioni','integrazioni.serie_documenti',30,false,true),
  ('integrazioni','integrazioni.ordini_pr',40,false,true),
  ('integrazioni','integrazioni.ordini_ph',50,false,true),
  ('integrazioni','integrazioni.documentale',60,false,true),
  ('integrazioni','integrazioni.progremes',70,false,true)
on conflict (modulo_codice,schermata_codice) do update set
  ordine=excluded.ordine,
  predefinita=excluded.predefinita,
  visibile_menu=excluded.visibile_menu;

commit;

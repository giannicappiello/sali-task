-- Align configurable Workspace headers with the canonical CRM/Activities store.
-- Metadata only: no operational project, task, activity or customer is changed.

begin;

update public.workspace_schermate
set nome='Progetti PRIVATE',
    descrizione='Progetti operativi condivisi con Attività, collegati al cliente CRM.',
    ultima_sincronizzazione=now()
where codice='crm.conto_terzi.progetti';

update public.workspace_schermate
set nome='Attività PRIVATE',
    descrizione='Task e fasi operative condivise con il modulo Attività e collegate al cliente CRM.',
    ultima_sincronizzazione=now()
where codice='crm.conto_terzi.attivita';

commit;

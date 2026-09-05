-- Registra l'archivio come vista del modulo Attività. I record chiusi restano
-- nelle tabelle canoniche: nessun dato operativo viene spostato o duplicato.

begin;

insert into public.workspace_schermate
  (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,icona,metadati,ultima_sincronizzazione)
values
  ('attivita.archivio','Archivio attività',
   'Storico unico di attività, task, progetti e reminder conclusi.',
   'workspace','/activities/archive','activities.archive',true,true,60,
   'operativita','archive','{"derived_view":true,"preserves_history":true}'::jsonb,now())
on conflict (codice) do update set
  nome=excluded.nome,descrizione=excluded.descrizione,provider=excluded.provider,
  percorso=excluded.percorso,chiave_componente=excluded.chiave_componente,
  protetta=true,attiva=true,ordine=excluded.ordine,area=excluded.area,
  icona=excluded.icona,metadati=excluded.metadati,ultima_sincronizzazione=now();

insert into public.workspace_moduli_schermate
  (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values ('attivita','attivita.archivio',50,false,true)
on conflict (modulo_codice,schermata_codice) do update set
  ordine=excluded.ordine,predefinita=false,visibile_menu=true;

commit;

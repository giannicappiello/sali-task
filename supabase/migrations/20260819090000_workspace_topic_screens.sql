begin;

insert into public.workspace_schermate
  (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,metadati)
values
  ('analisi.hub','Analisi dati','Pagina di argomento con tutte le schermate collegate al modulo.','workspace','/analisi-dati','analytics.hub',true,true,130,'{"kind":"topic"}'::jsonb)
on conflict (codice) do update set
  nome=excluded.nome,
  descrizione=excluded.descrizione,
  provider=excluded.provider,
  percorso=excluded.percorso,
  chiave_componente=excluded.chiave_componente,
  protetta=true,
  attiva=true,
  ordine=excluded.ordine,
  metadati=excluded.metadati;

update public.workspace_moduli_schermate
set predefinita=false
where modulo_codice='analisi_dati';

insert into public.workspace_moduli_schermate
  (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values
  ('analisi_dati','analisi.hub',0,true,false)
on conflict (modulo_codice,schermata_codice) do update set
  ordine=excluded.ordine,
  predefinita=true,
  visibile_menu=false;

update public.workspace_moduli
set percorso='/analisi-dati', aggiornato_il=now()
where codice='analisi_dati';

commit;

begin;
insert into public.workspace_schermate(codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,metadati)
values('integrazioni.ddt','Configurazioni DDT','Destinatari e invii email BCF, packing list e verifica contratto Mexal.','workspace','/integrations/configurazioni-ddt','integrations.ddt',false,true,935,
 '{"required_permissions":["integrations.read","integrations.configure"],"independent_access":true}'::jsonb)
on conflict(codice) do update set nome=excluded.nome,descrizione=excluded.descrizione,percorso=excluded.percorso,metadati=excluded.metadati,attiva=true,ultima_sincronizzazione=now();
insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values('integrazioni','integrazioni.ddt',35,false,true)
on conflict(modulo_codice,schermata_codice) do update set ordine=excluded.ordine,visibile_menu=true;
notify pgrst,'reload schema';
commit;

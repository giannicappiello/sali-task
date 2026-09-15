begin;
delete from public.workspace_moduli_schermate where schermata_codice='crm.b2b.analisi';
delete from public.workspace_schermate where codice='crm.b2b.analisi';
notify pgrst,'reload schema';
commit;

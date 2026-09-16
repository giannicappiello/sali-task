begin;
delete from public.workspace_moduli_schermate where schermata_codice='crm.conto_terzi.analisi';
delete from public.workspace_schermate where codice='crm.conto_terzi.analisi';
notify pgrst,'reload schema';
commit;

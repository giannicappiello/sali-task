begin;
insert into public.workspace_schermate(codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,aree,icona)
values('produzione.consuntivi_private','Consuntivi produzione Private','Consuntivi e confronto con il valore OCT delle quantità lavorate.','workspace','/consuntivi-produzioni-private','PrivateProductionCostReports',false,true,430,'vendite_private',array['vendite_private'],'chart-column')
on conflict(codice) do update set nome=excluded.nome,descrizione=excluded.descrizione,provider=excluded.provider,percorso=excluded.percorso,chiave_componente=excluded.chiave_componente,area=excluded.area,aree=excluded.aree,attiva=true;
insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
select 'progremes','produzione.consuntivi_private',coalesce(max(ordine),0)+10,false,true from public.workspace_moduli_schermate where modulo_codice='progremes' and schermata_codice<>'produzione.consuntivi_private'
on conflict(modulo_codice,schermata_codice) do update set ordine=excluded.ordine,visibile_menu=true;
notify pgrst,'reload schema';
commit;

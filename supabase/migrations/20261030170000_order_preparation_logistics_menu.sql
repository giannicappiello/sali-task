begin;
set local lock_timeout='5s';
insert into public.workspace_moduli(codice,nome,descrizione,tipo,area,aree,percorso,provider,sempre_disponibile,assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,icona)
values('allestisci_ordini','Allestisci Ordini','Preparazione OCM, scansioni, lotti FIFO, DDT e packing list.','modulo','logistica',array['logistica'],'/logistica/allestisci-ordini','workspace',false,true,true,true,true,66,'package')
on conflict(codice) do update set nome=excluded.nome,percorso=excluded.percorso,area=excluded.area,aree=excluded.aree,mostra_menu=true,attivo=true,aggiornato_il=now();
update public.workspace_schermate set percorso='/logistica/allestisci-ordini',area='logistica',aree=array['logistica'],ultima_sincronizzazione=now() where codice='magazzino.allestisci_ordini';
insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values('allestisci_ordini','magazzino.allestisci_ordini',10,true,true)
on conflict(modulo_codice,schermata_codice) do update set predefinita=true,visibile_menu=true;
delete from public.workspace_moduli_schermate where modulo_codice='magazzino' and schermata_codice='magazzino.allestisci_ordini';
update public.permessi set modulo='allestisci_ordini' where codice in('warehouse.fulfillment.read','warehouse.fulfillment.write','warehouse.fulfillment.configure');
insert into public.workspace_menu_voci(codice,nome,descrizione,icona,ordine,attiva)
values('logistica','Logistica','Magazzino e allestimento ordini.','truck',65,true)
on conflict(codice) do update set nome=excluded.nome,attiva=true,aggiornata_il=now();
insert into public.workspace_menu_moduli(voce_codice,modulo_codice,ordine)
values('logistica','magazzino',10),('logistica','allestisci_ordini',20)
on conflict(voce_codice,modulo_codice) do update set ordine=excluded.ordine;
-- Keep the old entry recoverable, without duplicating Magazzino at the root.
delete from public.workspace_menu_moduli where voce_codice='magazzino' and modulo_codice='magazzino';
update public.workspace_menu_voci m set attiva=false,aggiornata_il=now() where codice='magazzino' and not exists(select 1 from public.workspace_menu_moduli l where l.voce_codice=m.codice);
notify pgrst,'reload schema';
commit;

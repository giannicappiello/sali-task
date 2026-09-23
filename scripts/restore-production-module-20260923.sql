-- Explicit user-requested catalog restoration; no operational records or grants change.
begin;
delete from public.workspace_catalog_deletions
where kind='module' and code='progremes_produzione' and external_code='Produzione';

insert into public.workspace_moduli
  (codice,nome,descrizione,tipo,area,aree,percorso,provider,
   sempre_disponibile,assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine)
select 'progremes_produzione',nome,descrizione,'modulo','produzione',array['produzione'],
  '/produzione/progremes.Produzione','progremes',false,true,true,true,true,200+ordine
from public.progremes_moduli where codice='Produzione'
on conflict(codice) do update set attivo=true,mostra_menu=true;

insert into public.workspace_moduli_schermate
  (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values ('progremes_produzione','progremes.Produzione',10,true,true)
on conflict(modulo_codice,schermata_codice) do update set visibile_menu=true,predefinita=true;

update public.workspace_schermate
set attiva=true,nome='Avanzamento produzione',
  metadati=jsonb_set(metadati,'{catalog_source}',to_jsonb('workspace_restored_screen'::text))
where codice='progremes.Produzione' and provider='progremes'
  and metadati->>'external_route'='/produzione';

select m.codice,m.nome,m.attivo,m.mostra_menu,s.codice as schermata,s.attiva as schermata_attiva
from public.workspace_moduli m
join public.workspace_moduli_schermate l on l.modulo_codice=m.codice
join public.workspace_schermate s on s.codice=l.schermata_codice
where m.codice='progremes_produzione';
commit;

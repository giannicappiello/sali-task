begin;

-- Il calendario mostrato nelle Impostazioni ProgreMES e' una schermata autonoma.
-- L'autorizzazione esterna resta Planning, come richiesto dalla pagina originale.
insert into public.workspace_schermate (
  codice,nome,descrizione,provider,percorso,chiave_componente,
  protetta,attiva,ordine,metadati,ultima_sincronizzazione
)
values (
  'progremes.Planning.CalendarioAziendale',
  'Calendario aziendale',
  'Gestione delle festivita nazionali e delle chiusure aziendali escluse dalla pianificazione.',
  'progremes',
  '/produzione/progremes.Planning.CalendarioAziendale',
  null,
  false,
  true,
  780,
  '{"external_code":"Planning","external_route":"/impostazioni/calendario","catalog_source":"progremes_calendar_composition"}'::jsonb,
  now()
)
on conflict (codice) do update set
  nome=excluded.nome,
  descrizione=excluded.descrizione,
  provider=excluded.provider,
  percorso=excluded.percorso,
  attiva=excluded.attiva,
  ordine=excluded.ordine,
  metadati=workspace_schermate.metadati || excluded.metadati,
  ultima_sincronizzazione=excluded.ultima_sincronizzazione;

insert into public.workspace_moduli_schermate (
  modulo_codice,schermata_codice,ordine,predefinita,visibile_menu
)
values (
  'impostazioni','progremes.Planning.CalendarioAziendale',80,false,true
)
on conflict (modulo_codice,schermata_codice) do update set
  ordine=excluded.ordine,
  predefinita=excluded.predefinita,
  visibile_menu=excluded.visibile_menu;

-- Il permesso storico ProgreMES si chiama Formule, ma la relativa sezione
-- applicativa e' Documenti. Manteniamo il codice del modulo per non perdere
-- le autorizzazioni gia assegnate e ne aggiorniamo nome e composizione.
insert into public.workspace_moduli (
  codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,
  assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,icona,aggiornato_il
)
values (
  'progremes_formule',
  'Documenti',
  'Archivio documentale ProgreMES per certificati, fascicoli e schede prodotto.',
  'contenitore',
  'produzione',
  '/moduli/progremes_formule',
  'progremes',
  false,
  false,
  true,
  true,
  true,
  211,
  'file-archive',
  now()
)
on conflict (codice) do update set
  nome=excluded.nome,
  descrizione=excluded.descrizione,
  tipo='contenitore',
  area=excluded.area,
  percorso=excluded.percorso,
  provider=excluded.provider,
  configurabile_ruolo=true,
  mostra_menu=true,
  attivo=true,
  icona=excluded.icona,
  aggiornato_il=now();

insert into public.workspace_schermate (
  codice,nome,descrizione,provider,percorso,chiave_componente,
  protetta,attiva,ordine,metadati,ultima_sincronizzazione
)
values
  ('progremes.Formule.CoaProduzioni','COA produzioni','Compila, emetti e stampa i certificati per lotto di semilavorati e prodotti finiti.','progremes','/produzione/progremes.Formule.CoaProduzioni',null,false,true,810,'{"external_code":"Formule","external_route":"/documenti/coa/compila","catalog_source":"progremes_documents_composition"}'::jsonb,now()),
  ('progremes.Formule.CoaArticoli','COA articoli','Archivio dei certificati ricevuti o caricati per materie prime, semilavorati e prodotti finiti.','progremes','/produzione/progremes.Formule.CoaArticoli',null,false,true,820,'{"external_code":"Formule","external_route":"/documenti/coa","catalog_source":"progremes_documents_composition"}'::jsonb,now()),
  ('progremes.Formule.Pif','PIF','Product Information File e fascicoli informativi dei prodotti finiti.','progremes','/produzione/progremes.Formule.Pif',null,false,true,830,'{"external_code":"Formule","external_route":"/documenti/pif","catalog_source":"progremes_documents_composition"}'::jsonb,now()),
  ('progremes.Formule.SchedeTecniche','Schede tecniche','Specifiche, caratteristiche e informazioni tecniche degli articoli.','progremes','/produzione/progremes.Formule.SchedeTecniche',null,false,true,840,'{"external_code":"Formule","external_route":"/documenti/schede-tecniche","catalog_source":"progremes_documents_composition"}'::jsonb,now()),
  ('progremes.Formule.SchedeSicurezza','Schede di sicurezza','SDS e MSDS delle materie prime utilizzate nella produzione.','progremes','/produzione/progremes.Formule.SchedeSicurezza',null,false,true,850,'{"external_code":"Formule","external_route":"/documenti/schede-sicurezza","catalog_source":"progremes_documents_composition"}'::jsonb,now())
on conflict (codice) do update set
  nome=excluded.nome,
  descrizione=excluded.descrizione,
  provider=excluded.provider,
  percorso=excluded.percorso,
  attiva=excluded.attiva,
  ordine=excluded.ordine,
  metadati=workspace_schermate.metadati || excluded.metadati,
  ultima_sincronizzazione=excluded.ultima_sincronizzazione;

-- L'hub unico /documenti non deve piu comparire come schermata utilizzabile.
delete from public.workspace_moduli_schermate
where schermata_codice='progremes.Formule';

update public.workspace_schermate
set attiva=false,
    metadati=metadati || '{"kind":"topic","replaced_by_composed_screens":true}'::jsonb,
    ultima_sincronizzazione=now()
where codice='progremes.Formule';

insert into public.workspace_moduli_schermate (
  modulo_codice,schermata_codice,ordine,predefinita,visibile_menu
)
values
  ('progremes_formule','progremes.Formule.CoaProduzioni',10,false,true),
  ('progremes_formule','progremes.Formule.CoaArticoli',20,false,true),
  ('progremes_formule','progremes.Formule.Pif',30,false,true),
  ('progremes_formule','progremes.Formule.SchedeTecniche',40,false,true),
  ('progremes_formule','progremes.Formule.SchedeSicurezza',50,false,true)
on conflict (modulo_codice,schermata_codice) do update set
  ordine=excluded.ordine,
  predefinita=excluded.predefinita,
  visibile_menu=excluded.visibile_menu;

-- Le sincronizzazioni successive del catalogo devono conservare sia Ordini
-- sia Documenti come moduli composti, senza ripristinare i vecchi hub unici.
create or replace function public.sync_progremes_workspace_module()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  module_code text := public.workspace_progremes_module_code(new.codice);
  screen_code text := case when new.codice like 'progremes.%' then new.codice else 'progremes.' || new.codice end;
  screen_path text := '/produzione/' || replace(screen_code, '/', '%2F');
  is_orders_module boolean := lower(btrim(new.codice)) = 'ordini';
  is_documents_module boolean := lower(btrim(new.codice)) = 'formule';
  is_composed_module boolean := is_orders_module or is_documents_module;
begin
  insert into public.workspace_schermate
    (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,metadati,ultima_sincronizzazione)
  values
    (screen_code,new.nome,new.descrizione,'progremes',screen_path,null,false,
     case when is_documents_module then false else new.attivo end,
     new.ordine,
     jsonb_build_object('external_code',new.codice,'external_route',new.percorso,'catalog_source','progremes_modules'),new.ultima_sincronizzazione)
  on conflict (codice) do update set
    attiva=excluded.attiva,
    metadati=workspace_schermate.metadati || excluded.metadati,
    ultima_sincronizzazione=excluded.ultima_sincronizzazione;

  insert into public.workspace_moduli
    (codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,aggiornato_il)
  values
    (module_code,
     case when is_documents_module then 'Documenti' else new.nome end,
     case when is_documents_module then 'Archivio documentale ProgreMES per certificati, fascicoli e schede prodotto.' else new.descrizione end,
     case when is_composed_module then 'contenitore' else 'modulo' end,
     'produzione',
     case when is_composed_module then '/moduli/' || module_code else screen_path end,
     'progremes',false,false,true,
     case when is_documents_module then true else false end,
     new.attivo,200+new.ordine,now())
  on conflict (codice) do update set
    nome=case when is_documents_module then 'Documenti' else excluded.nome end,
    descrizione=case when is_documents_module then excluded.descrizione else workspace_moduli.descrizione end,
    tipo=case when is_composed_module then 'contenitore' else workspace_moduli.tipo end,
    area=excluded.area,
    percorso=case when is_composed_module then excluded.percorso else workspace_moduli.percorso end,
    provider=excluded.provider,
    configurabile_ruolo=true,
    mostra_menu=case when is_documents_module then true else workspace_moduli.mostra_menu end,
    attivo=excluded.attivo,
    ordine=excluded.ordine,
    aggiornato_il=now();

  if is_composed_module then
    delete from public.workspace_moduli_schermate
    where modulo_codice=module_code and schermata_codice=screen_code;
  else
    insert into public.workspace_moduli_schermate
      (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
    values (module_code,screen_code,10,true,true)
    on conflict (modulo_codice,schermata_codice) do update set
      ordine=10,predefinita=true,visibile_menu=true;
  end if;
  return new;
end $$;

commit;

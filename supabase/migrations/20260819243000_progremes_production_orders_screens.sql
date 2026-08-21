begin;

-- Il vecchio hub ProgreMES /gestione-ordini viene rappresentato nel Workspace
-- dalle quattro aree operative che contiene realmente.
insert into public.workspace_schermate (
  codice,
  nome,
  descrizione,
  provider,
  percorso,
  chiave_componente,
  protetta,
  attiva,
  ordine,
  metadati,
  ultima_sincronizzazione
)
values
  (
    'progremes.Ordini.Preventivo',
    'Calcolo prezzi e preventivo',
    'Calcola il prezzo di semilavorati e prodotti finiti applicando i costi di produzione e confezionamento.',
    'progremes',
    '/produzione/progremes.Ordini.Preventivo',
    null,
    false,
    true,
    710,
    '{"external_code":"Ordini","external_route":"/ordini/preventivo","catalog_source":"progremes_orders_composition"}'::jsonb,
    now()
  ),
  (
    'progremes.Ordini.Cliente',
    'Ordini cliente',
    'Consulta gli ordini importati da Mexal e genera i relativi ordini di produzione.',
    'progremes',
    '/produzione/progremes.Ordini.Cliente',
    null,
    false,
    true,
    720,
    '{"external_code":"Ordini","external_route":"/ordini/cliente","catalog_source":"progremes_orders_composition"}'::jsonb,
    now()
  ),
  (
    'progremes.Ordini.Produzione',
    'Ordini produzione',
    'Crea, modifica e controlla gli ordini utilizzati dal planning e dalla produzione.',
    'progremes',
    '/produzione/progremes.Ordini.Produzione',
    null,
    false,
    true,
    730,
    '{"external_code":"Ordini","external_route":"/ordini/produzione","catalog_source":"progremes_orders_composition"}'::jsonb,
    now()
  ),
  (
    'progremes.Ordini.Fabbisogni',
    'Fabbisogni acquisto',
    'Calcola materie prime e packaging da ordinare considerando giacenze, lotti e tempi di riordino.',
    'progremes',
    '/produzione/progremes.Ordini.Fabbisogni',
    null,
    false,
    true,
    740,
    '{"external_code":"Ordini","external_route":"/fabbisogni-acquisto","catalog_source":"progremes_orders_composition"}'::jsonb,
    now()
  )
on conflict (codice) do update set
  nome = excluded.nome,
  descrizione = excluded.descrizione,
  provider = excluded.provider,
  percorso = excluded.percorso,
  attiva = excluded.attiva,
  ordine = excluded.ordine,
  metadati = workspace_schermate.metadati || excluded.metadati,
  ultima_sincronizzazione = excluded.ultima_sincronizzazione;

update public.workspace_moduli
set
  tipo = 'contenitore',
  percorso = '/moduli/progremes_ordini',
  aggiornato_il = now()
where codice = 'progremes_ordini';

delete from public.workspace_moduli_schermate
where modulo_codice = 'progremes_ordini'
  and schermata_codice = 'progremes.Ordini';

insert into public.workspace_moduli_schermate (
  modulo_codice,
  schermata_codice,
  ordine,
  predefinita,
  visibile_menu
)
values
  ('progremes_ordini', 'progremes.Ordini.Preventivo', 10, false, true),
  ('progremes_ordini', 'progremes.Ordini.Cliente', 20, false, true),
  ('progremes_ordini', 'progremes.Ordini.Produzione', 30, false, true),
  ('progremes_ordini', 'progremes.Ordini.Fabbisogni', 40, false, true)
on conflict (modulo_codice, schermata_codice) do update set
  ordine = excluded.ordine,
  predefinita = excluded.predefinita,
  visibile_menu = excluded.visibile_menu;

-- La sincronizzazione futura deve mantenere questa composizione e non ricreare
-- il collegamento unico verso l'hub /gestione-ordini.
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
begin
  insert into public.workspace_schermate
    (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,metadati,ultima_sincronizzazione)
  values
    (screen_code,new.nome,new.descrizione,'progremes',screen_path,null,false,new.attivo,new.ordine,
     jsonb_build_object('external_code',new.codice,'external_route',new.percorso,'catalog_source','progremes_modules'),new.ultima_sincronizzazione)
  on conflict (codice) do update set
    attiva=excluded.attiva,
    metadati=workspace_schermate.metadati || excluded.metadati,
    ultima_sincronizzazione=excluded.ultima_sincronizzazione;

  insert into public.workspace_moduli
    (codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,aggiornato_il)
  values
    (module_code,new.nome,new.descrizione,
     case when is_orders_module then 'contenitore' else 'modulo' end,
     'produzione',
     case when is_orders_module then '/moduli/' || module_code else screen_path end,
     'progremes',false,false,true,false,new.attivo,200+new.ordine,now())
  on conflict (codice) do update set
    nome=excluded.nome,
    descrizione=excluded.descrizione,
    tipo=case when is_orders_module then 'contenitore' else workspace_moduli.tipo end,
    area=excluded.area,
    percorso=case when is_orders_module then excluded.percorso else workspace_moduli.percorso end,
    provider=excluded.provider,
    configurabile_ruolo=true,
    attivo=excluded.attivo,
    ordine=excluded.ordine,
    aggiornato_il=now();

  if is_orders_module then
    delete from public.workspace_moduli_schermate
    where modulo_codice = module_code and schermata_codice = screen_code;
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

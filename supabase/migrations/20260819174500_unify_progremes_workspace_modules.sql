begin;

-- L'area operativa usa il codice storico `progremes` perché permessi e reparti
-- dipendono già da quel codice. Cambiano solo nome e route Workspace.
update public.workspace_moduli
set nome = 'Gestione produzione',
    descrizione = 'Area operativa che raccoglie i moduli e le schermate ProgreMES.',
    tipo = 'contenitore',
    area = 'produzione',
    percorso = '/produzione',
    provider = 'progremes',
    mostra_menu = true,
    attivo = true,
    aggiornato_il = now()
where codice = 'progremes';

create or replace function public.workspace_progremes_module_code(external_code text)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select 'progremes_' || trim(both '_' from regexp_replace(lower(btrim(external_code)), '[^a-z0-9]+', '_', 'g'))
$$;

-- Completa eventuali schermate mancanti prima di creare i collegamenti.
insert into public.workspace_schermate
  (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,metadati,ultima_sincronizzazione)
select
  case when m.codice like 'progremes.%' then m.codice else 'progremes.' || m.codice end,
  m.nome,
  m.descrizione,
  'progremes',
  '/produzione/' || replace(case when m.codice like 'progremes.%' then m.codice else 'progremes.' || m.codice end, '/', '%2F'),
  null,
  false,
  m.attivo,
  m.ordine,
  jsonb_build_object('external_code',m.codice,'external_route',m.percorso,'catalog_source','progremes_modules'),
  m.ultima_sincronizzazione
from public.progremes_moduli m
on conflict (codice) do update set
  attiva = excluded.attiva,
  metadati = workspace_schermate.metadati || excluded.metadati,
  ultima_sincronizzazione = excluded.ultima_sincronizzazione;

insert into public.workspace_moduli
  (codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,aggiornato_il)
select
  public.workspace_progremes_module_code(m.codice),
  m.nome,
  m.descrizione,
  'modulo',
  'produzione',
  '/produzione/' || replace(case when m.codice like 'progremes.%' then m.codice else 'progremes.' || m.codice end, '/', '%2F'),
  'progremes',
  false,
  false,
  true,
  false,
  m.attivo,
  200 + m.ordine,
  now()
from public.progremes_moduli m
on conflict (codice) do update set
  nome = excluded.nome,
  descrizione = excluded.descrizione,
  area = excluded.area,
  percorso = excluded.percorso,
  provider = excluded.provider,
  configurabile_ruolo = excluded.configurabile_ruolo,
  attivo = excluded.attivo,
  ordine = excluded.ordine,
  aggiornato_il = now();

insert into public.workspace_moduli_schermate
  (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
select
  public.workspace_progremes_module_code(m.codice),
  case when m.codice like 'progremes.%' then m.codice else 'progremes.' || m.codice end,
  10,
  true,
  true
from public.progremes_moduli m
on conflict (modulo_codice,schermata_codice) do update set
  ordine = 10,
  predefinita = true,
  visibile_menu = true;

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
    (module_code,new.nome,new.descrizione,'modulo','produzione',screen_path,'progremes',false,false,true,false,new.attivo,200+new.ordine,now())
  on conflict (codice) do update set
    nome=excluded.nome,
    descrizione=excluded.descrizione,
    area=excluded.area,
    percorso=excluded.percorso,
    provider=excluded.provider,
    configurabile_ruolo=true,
    attivo=excluded.attivo,
    ordine=excluded.ordine,
    aggiornato_il=now();

  insert into public.workspace_moduli_schermate
    (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
  values (module_code,screen_code,10,true,true)
  on conflict (modulo_codice,schermata_codice) do update set
    ordine=10,predefinita=true,visibile_menu=true;
  return new;
end $$;

drop trigger if exists sync_progremes_workspace_module on public.progremes_moduli;
create trigger sync_progremes_workspace_module
after insert or update of codice,nome,descrizione,percorso,attivo,ordine,ultima_sincronizzazione
on public.progremes_moduli
for each row execute function public.sync_progremes_workspace_module();

revoke all on function public.workspace_progremes_module_code(text) from public, anon;
grant execute on function public.workspace_progremes_module_code(text) to authenticated, service_role;

commit;

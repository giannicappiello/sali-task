begin;

-- Impostazioni diventa un modulo Workspace reale, protetto e non assegnabile.
insert into public.workspace_moduli (
  codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,
  assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,protetto,aggiornato_il
)
values (
  'impostazioni','Impostazioni','Amministrazione, accessi e configurazione del Workspace.',
  'contenitore','amministrazione','/settings','workspace',true,false,false,true,true,910,true,now()
)
on conflict (codice) do update set
  nome=excluded.nome,
  descrizione=excluded.descrizione,
  tipo='contenitore',
  area='amministrazione',
  percorso='/settings',
  provider='workspace',
  sempre_disponibile=true,
  assegnabile_reparto=false,
  configurabile_ruolo=false,
  mostra_menu=true,
  attivo=true,
  ordine=excluded.ordine,
  protetto=true,
  aggiornato_il=now();

insert into public.workspace_schermate (
  codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,metadati,ultima_sincronizzazione
)
values
  ('impostazioni','Panoramica impostazioni','Accesso alle aree di amministrazione del Workspace.','workspace','/settings','settings.hub',true,true,0,'{"kind":"topic"}'::jsonb,now()),
  ('impostazioni.team','Team','Utenti, accessi, moduli e relazioni.','workspace','/settings/team','settings.team',false,true,10,'{"required_permissions":["settings.manage","users.manage"]}'::jsonb,now()),
  ('impostazioni.organizzazione','Reparti e ruoli','Struttura, ruoli, permessi e livelli operativi.','workspace','/settings/organization','settings.organization',false,true,20,'{"required_permissions":["settings.manage","users.manage"]}'::jsonb,now()),
  ('impostazioni.progetti','Voci di progetto','Checklist, tipi e regole dei progetti.','workspace','/settings/projects','settings.projects',false,true,30,'{"required_permissions":["settings.manage"]}'::jsonb,now()),
  ('impostazioni.moduli','Moduli e schermate','Catalogo e composizione dei moduli Workspace e ProgreMES.','workspace','/settings/modules','settings.modules',false,true,40,'{"admin_only":true}'::jsonb,now()),
  ('impostazioni.ai','Configurazione AI','Capacità, accessi, Web e limiti dell’assistente.','workspace','/settings/ai','settings.ai',false,true,50,'{"required_permissions":["settings.manage"]}'::jsonb,now()),
  ('impostazioni.notifiche','Notifiche','Dispositivi, suoni, preferenze ed eventi.','workspace','/settings/notifications','settings.notifications',false,true,60,'{}'::jsonb,now()),
  ('impostazioni.diagnostica_mexal','Diagnostica Mexal','Controlli tecnici e verifica delle sincronizzazioni Mexal.','workspace','/settings/mexal-diagnostics','settings.mexal_diagnostics',false,true,70,'{"required_permissions":["settings.manage"]}'::jsonb,now())
on conflict (codice) do update set
  nome=excluded.nome,
  descrizione=excluded.descrizione,
  provider=excluded.provider,
  percorso=excluded.percorso,
  chiave_componente=excluded.chiave_componente,
  protetta=case when workspace_schermate.codice='impostazioni' then true else workspace_schermate.protetta end,
  attiva=case when workspace_schermate.codice='impostazioni' then true else workspace_schermate.attiva end,
  ordine=excluded.ordine,
  metadati=workspace_schermate.metadati || excluded.metadati,
  ultima_sincronizzazione=now();

insert into public.workspace_moduli_schermate (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values
  ('impostazioni','impostazioni',0,true,false),
  ('impostazioni','impostazioni.team',10,false,true),
  ('impostazioni','impostazioni.organizzazione',20,false,true),
  ('impostazioni','impostazioni.progetti',30,false,true),
  ('impostazioni','impostazioni.moduli',40,false,true),
  ('impostazioni','impostazioni.ai',50,false,true),
  ('impostazioni','impostazioni.notifiche',60,false,true),
  ('impostazioni','impostazioni.diagnostica_mexal',70,false,true)
on conflict (modulo_codice,schermata_codice) do nothing;

-- Le schermate ProgreMES appartengono anche al contenitore Gestione produzione.
insert into public.workspace_moduli_schermate (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
select
  'progremes',
  case when modulo.codice like 'progremes.%' then modulo.codice else 'progremes.' || modulo.codice end,
  modulo.ordine,
  false,
  true
from public.progremes_moduli modulo
join public.workspace_schermate schermata
  on schermata.codice=case when modulo.codice like 'progremes.%' then modulo.codice else 'progremes.' || modulo.codice end
on conflict (modulo_codice,schermata_codice) do nothing;

-- I nuovi moduli sincronizzati vengono aggiunti al contenitore una sola volta;
-- le successive scelte manuali dell'amministratore non vengono sovrascritte.
create or replace function public.add_new_progremes_screen_to_production_hub()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  screen_code text := case when new.codice like 'progremes.%' then new.codice else 'progremes.' || new.codice end;
begin
  insert into public.workspace_moduli_schermate (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
  select 'progremes',screen_code,new.ordine,false,true
  from public.workspace_schermate
  where codice=screen_code
  on conflict (modulo_codice,schermata_codice) do nothing;
  return new;
end $$;

drop trigger if exists zz_add_progremes_screen_to_production_hub on public.progremes_moduli;
create trigger zz_add_progremes_screen_to_production_hub
after insert on public.progremes_moduli
for each row execute function public.add_new_progremes_screen_to_production_hub();

-- I contenitori protetti mantengono la propria route anche quando cambiano le schermate.
create or replace function public.admin_save_workspace_module(
  target_module jsonb,
  target_screen_codes text[],
  target_default_screen text
)
returns void language plpgsql security definer set search_path=public as $$
declare
  target_code text := lower(btrim(coalesce(target_module->>'codice','')));
  normalized_screen_codes text[] := coalesce(target_screen_codes, array[]::text[]);
  target_path text := nullif(btrim(target_module->>'percorso'),'');
  existing_protected boolean := false;
  existing_type text;
  existing_path text;
begin
  if not public.workspace_user_is_admin() then raise exception 'Operazione riservata all''amministratore Workspace.'; end if;
  if target_code !~ '^[a-z0-9_]+$' or btrim(coalesce(target_module->>'nome',''))='' then raise exception 'Codice o nome modulo non valido.'; end if;

  select protetto,tipo,percorso into existing_protected,existing_type,existing_path
  from public.workspace_moduli where codice=target_code;

  if coalesce(array_length(normalized_screen_codes,1),0)>0 then
    if target_default_screen is null or not (target_default_screen=any(normalized_screen_codes)) then
      target_default_screen := normalized_screen_codes[1];
    end if;
    if coalesce(existing_protected,false) and existing_type='contenitore' then
      target_path := coalesce(existing_path,target_path,'/moduli/' || target_code);
    else
      select percorso into target_path from public.workspace_schermate where codice=target_default_screen and attiva;
      if target_path is null then raise exception 'Schermata iniziale non disponibile.'; end if;
    end if;
  else
    target_default_screen := null;
    target_path := coalesce(existing_path,target_path,'/moduli/' || target_code);
  end if;

  insert into public.workspace_moduli
    (codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,aggiornato_il)
  values
    (target_code,btrim(target_module->>'nome'),nullif(btrim(target_module->>'descrizione'),''),coalesce(nullif(target_module->>'tipo',''),'modulo'),nullif(btrim(target_module->>'area'),''),target_path,coalesce(nullif(target_module->>'provider',''),'workspace'),coalesce((target_module->>'sempre_disponibile')::boolean,false),coalesce((target_module->>'assegnabile_reparto')::boolean,false),coalesce((target_module->>'configurabile_ruolo')::boolean,true),coalesce((target_module->>'mostra_menu')::boolean,true),coalesce((target_module->>'attivo')::boolean,true),coalesce((target_module->>'ordine')::integer,0),now())
  on conflict (codice) do update set
    nome=excluded.nome,
    descrizione=excluded.descrizione,
    tipo=case when workspace_moduli.protetto then workspace_moduli.tipo else excluded.tipo end,
    area=excluded.area,
    percorso=case when workspace_moduli.protetto and workspace_moduli.tipo='contenitore' then workspace_moduli.percorso else excluded.percorso end,
    provider=case when workspace_moduli.protetto then workspace_moduli.provider else excluded.provider end,
    sempre_disponibile=case when workspace_moduli.protetto then true else excluded.sempre_disponibile end,
    assegnabile_reparto=case when workspace_moduli.protetto then false else excluded.assegnabile_reparto end,
    configurabile_ruolo=excluded.configurabile_ruolo,
    mostra_menu=excluded.mostra_menu,
    attivo=case when workspace_moduli.protetto then true else excluded.attivo end,
    ordine=excluded.ordine,
    aggiornato_il=now();

  delete from public.workspace_moduli_schermate
  where modulo_codice=target_code and not (schermata_codice=any(normalized_screen_codes));

  insert into public.workspace_moduli_schermate (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
  select target_code,code,ordinality::integer*10,code=target_default_screen,true
  from unnest(normalized_screen_codes) with ordinality as selected(code,ordinality)
  join public.workspace_schermate screen on screen.codice=selected.code and screen.attiva
  on conflict (modulo_codice,schermata_codice) do update set
    ordine=excluded.ordine,predefinita=excluded.predefinita,visibile_menu=true;
end $$;

revoke all on function public.admin_save_workspace_module(jsonb,text[],text), public.add_new_progremes_screen_to_production_hub() from public,anon;
grant execute on function public.admin_save_workspace_module(jsonb,text[],text) to authenticated;
grant execute on function public.add_new_progremes_screen_to_production_hub() to service_role;

commit;

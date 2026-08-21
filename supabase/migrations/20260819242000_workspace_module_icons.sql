begin;

alter table public.workspace_moduli
  add column if not exists icona text not null default 'blocks';

update public.workspace_moduli
set icona = case codice
  when 'home' then 'home'
  when 'attivita' then 'clipboard'
  when 'beauty_days' then 'store'
  when 'ordini_pr' then 'shopping-cart'
  when 'ordini_ph' then 'shopping-cart'
  when 'prodotti' then 'package'
  when 'documenti' then 'file-archive'
  when 'assistente_ai' then 'bot'
  when 'progremes' then 'factory'
  when 'produzione' then 'workflow'
  when 'analisi_dati' then 'chart'
  when 'messaggi' then 'message'
  when 'notifiche' then 'bell'
  when 'team' then 'users'
  when 'integrazioni' then 'plug'
  when 'impostazioni' then 'settings'
  else coalesce(nullif(icona, ''), 'blocks')
end;

comment on column public.workspace_moduli.icona is
  'Codice dell''icona Lucide selezionata dall''amministratore per menu, Home e contenitore del modulo.';

create or replace function public.admin_save_workspace_module(
  target_module jsonb,
  target_screen_codes text[],
  target_default_screen text
)
returns void language plpgsql security definer set search_path=public as $$
declare
  target_code text := lower(btrim(coalesce(target_module->>'codice','')));
  normalized_screen_codes text[] := coalesce(target_screen_codes,array[]::text[]);
  target_path text := nullif(btrim(target_module->>'percorso'),'');
  target_type text := coalesce(nullif(target_module->>'tipo',''),'modulo');
  target_icon text := lower(btrim(coalesce(target_module->>'icona','blocks')));
  existing_protected boolean := false;
  existing_type text;
  existing_path text;
  dedicated_container boolean := false;
begin
  if not public.workspace_user_is_admin() then raise exception 'Operazione riservata all''amministratore Workspace.'; end if;
  if target_code !~ '^[a-z0-9_]+$' or btrim(coalesce(target_module->>'nome',''))='' then raise exception 'Codice o nome modulo non valido.'; end if;
  if target_icon !~ '^[a-z0-9-]+$' then target_icon := 'blocks'; end if;

  select protetto,tipo,percorso into existing_protected,existing_type,existing_path
  from public.workspace_moduli where codice=target_code;

  dedicated_container := coalesce(existing_type='contenitore' and existing_path is not null and existing_path not like '/moduli/%',false);

  if target_default_screen is not null and target_default_screen=any(normalized_screen_codes) then
    select percorso into target_path
    from public.workspace_schermate
    where codice=target_default_screen and attiva;
    if target_path is null then raise exception 'Schermata iniziale non disponibile.'; end if;
  else
    target_default_screen := null;
    target_type := 'contenitore';
    target_path := case
      when dedicated_container then existing_path
      else '/moduli/' || target_code
    end;
  end if;

  if dedicated_container then
    target_type := 'contenitore';
    target_path := existing_path;
  end if;

  insert into public.workspace_moduli
    (codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,icona,aggiornato_il)
  values
    (target_code,btrim(target_module->>'nome'),nullif(btrim(target_module->>'descrizione'),''),target_type,nullif(btrim(target_module->>'area'),''),target_path,coalesce(nullif(target_module->>'provider',''),'workspace'),coalesce((target_module->>'sempre_disponibile')::boolean,false),coalesce((target_module->>'assegnabile_reparto')::boolean,false),coalesce((target_module->>'configurabile_ruolo')::boolean,true),coalesce((target_module->>'mostra_menu')::boolean,true),coalesce((target_module->>'attivo')::boolean,true),coalesce((target_module->>'ordine')::integer,0),target_icon,now())
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
    icona=excluded.icona,
    aggiornato_il=now();

  delete from public.workspace_moduli_schermate
  where modulo_codice=target_code and not (schermata_codice=any(normalized_screen_codes));

  insert into public.workspace_moduli_schermate (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
  select target_code,code,ordinality::integer*10,coalesce(code=target_default_screen,false),true
  from unnest(normalized_screen_codes) with ordinality as selected(code,ordinality)
  join public.workspace_schermate screen on screen.codice=selected.code and screen.attiva
  on conflict (modulo_codice,schermata_codice) do update set
    ordine=excluded.ordine,predefinita=excluded.predefinita,visibile_menu=true;
end $$;

revoke all on function public.admin_save_workspace_module(jsonb,text[],text) from public,anon;
grant execute on function public.admin_save_workspace_module(jsonb,text[],text) to authenticated;

commit;

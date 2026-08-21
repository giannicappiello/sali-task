begin;

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
begin
  if not public.workspace_user_is_admin() then raise exception 'Operazione riservata all''amministratore Workspace.'; end if;
  if target_code !~ '^[a-z0-9_]+$' or btrim(coalesce(target_module->>'nome',''))='' then raise exception 'Codice o nome modulo non valido.'; end if;

  if coalesce(array_length(normalized_screen_codes,1),0)>0 then
    if target_default_screen is null or not (target_default_screen=any(normalized_screen_codes)) then
      target_default_screen := normalized_screen_codes[1];
    end if;
    select percorso into target_path
    from public.workspace_schermate
    where codice=target_default_screen and attiva;
    if target_path is null then raise exception 'Schermata iniziale non disponibile.'; end if;
  else
    target_default_screen := null;
    target_path := coalesce(target_path, '/moduli/' || target_code);
  end if;

  insert into public.workspace_moduli
    (codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,aggiornato_il)
  values
    (target_code,btrim(target_module->>'nome'),nullif(btrim(target_module->>'descrizione'),''),coalesce(nullif(target_module->>'tipo',''),'modulo'),nullif(btrim(target_module->>'area'),''),target_path,coalesce(nullif(target_module->>'provider',''),'workspace'),false,coalesce((target_module->>'assegnabile_reparto')::boolean,false),coalesce((target_module->>'configurabile_ruolo')::boolean,true),coalesce((target_module->>'mostra_menu')::boolean,true),coalesce((target_module->>'attivo')::boolean,true),coalesce((target_module->>'ordine')::integer,0),now())
  on conflict (codice) do update set
    nome=excluded.nome, descrizione=excluded.descrizione, tipo=excluded.tipo, area=excluded.area,
    percorso=excluded.percorso, provider=excluded.provider,
    assegnabile_reparto=case when workspace_moduli.protetto then false else excluded.assegnabile_reparto end,
    configurabile_ruolo=excluded.configurabile_ruolo, mostra_menu=excluded.mostra_menu,
    attivo=case when workspace_moduli.protetto then true else excluded.attivo end,
    ordine=excluded.ordine, aggiornato_il=now();

  delete from public.workspace_moduli_schermate
  where modulo_codice=target_code and not (schermata_codice=any(normalized_screen_codes));

  insert into public.workspace_moduli_schermate (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
  select target_code, code, ordinality::integer*10, code=target_default_screen, true
  from unnest(normalized_screen_codes) with ordinality as selected(code,ordinality)
  join public.workspace_schermate screen on screen.codice=selected.code and screen.attiva
  on conflict (modulo_codice,schermata_codice) do update set
    ordine=excluded.ordine, predefinita=excluded.predefinita, visibile_menu=true;
end $$;

revoke all on function public.admin_save_workspace_module(jsonb,text[],text) from public, anon;
grant execute on function public.admin_save_workspace_module(jsonb,text[],text) to authenticated;

commit;

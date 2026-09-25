begin;
create or replace function public.admin_save_workspace_screen_modules(target_screen jsonb, target_module_codes text[])
returns void language plpgsql security definer set search_path=public as $fn$
declare screen_code text := target_screen->>'codice'; selected_codes text[]; removed_defaults text[]; screen_path text;
begin
 if not public.workspace_user_is_admin() then raise exception 'Operazione riservata all''amministratore Workspace.' using errcode='42501'; end if;
 select coalesce(array_agg(distinct code),'{}') into selected_codes from unnest(coalesce(target_module_codes,'{}')) code;
 if exists(select 1 from unnest(selected_codes) code where code is null or not exists(select 1 from workspace_moduli where codice=code)) then raise exception 'Modulo non valido.'; end if;
 -- Lock modules before changing their membership, preserving each existing link's settings.
 perform 1 from workspace_moduli where codice=any(selected_codes) or codice in (select modulo_codice from workspace_moduli_schermate where schermata_codice=screen_code) order by codice for update;
 perform public.admin_update_workspace_screen(target_screen);
 select percorso into screen_path from workspace_schermate where codice=screen_code;
 select array_agg(modulo_codice) into removed_defaults from workspace_moduli_schermate where schermata_codice=screen_code and predefinita and not (modulo_codice=any(selected_codes));
 delete from workspace_moduli_schermate where schermata_codice=screen_code and not (modulo_codice=any(selected_codes));
 insert into workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
 select code,screen_code,coalesce((select max(l.ordine) from workspace_moduli_schermate l where l.modulo_codice=code),0)+10,false,true from unnest(selected_codes) code
 on conflict(modulo_codice,schermata_codice) do nothing;
 -- A removed initial screen must not remain the module's navigation destination.
 update workspace_moduli set percorso='/moduli/'||codice,tipo='contenitore',aggiornato_il=now()
 where codice=any(coalesce(removed_defaults,'{}')) and percorso=screen_path
 and not exists(select 1 from workspace_moduli_schermate l where l.modulo_codice=workspace_moduli.codice and l.predefinita);
end $fn$;
revoke all on function public.admin_save_workspace_screen_modules(jsonb,text[]) from public,anon;
grant execute on function public.admin_save_workspace_screen_modules(jsonb,text[]) to authenticated;
notify pgrst, 'reload schema';
commit;

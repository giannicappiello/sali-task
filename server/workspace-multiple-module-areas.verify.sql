-- Execute after migration inside a transaction, then ROLLBACK.
do $test$
declare actor uuid; admin_auth uuid; auth_actor uuid; before_revision bigint; failed boolean; payload jsonb; snap jsonb;
begin
 select id,auth_user_id into actor,auth_actor from public.utenti
 where attivo and not public.workspace_user_is_admin(auth_user_id) and auth_user_id is not null limit 1;
 select auth_user_id into admin_auth from public.utenti where attivo and public.workspace_user_is_admin(auth_user_id) limit 1;
 if actor is null or admin_auth is null then raise exception 'Active admin/non-admin fixtures required'; end if;
 perform set_config('request.jwt.claim.sub',admin_auth::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 insert into public.workspace_aree(codice,nome) values ('test_module_a','Test A'),('test_module_b','Test B');
 insert into public.workspace_moduli(codice,nome,tipo,percorso,area,sempre_disponibile) values('test_multi_module','Test','contenitore','/moduli/test_multi_module','test_module_a',true);
 insert into public.workspace_schermate(codice,nome,percorso,area) values('test.module.screen','Test','/test-module-screen','test_module_a');
 if (select aree from public.workspace_moduli where codice='test_multi_module') <> array['test_module_a'] then raise exception 'Legacy insert not backfilled'; end if;
 if public.workspace_module_enabled_for_user(actor,'test_multi_module') then raise exception 'Unassigned area grants module'; end if;
 insert into public.workspace_utenti_aree(utente_id,area_codice) values(actor,'test_module_b');
 select revision into before_revision from public.workspace_access_revision where id;
 payload=jsonb_build_object('codice','test_multi_module','nome','Test','sempre_disponibile',true,'aree',jsonb_build_array('test_module_a','test_module_b','test_module_b'));
 perform public.admin_save_workspace_module(payload,array['test.module.screen'],null);
 if (select aree from public.workspace_moduli where codice='test_multi_module')<>array['test_module_a','test_module_b'] then raise exception 'Multi-area save/normalization failed'; end if;
 if (select aree from public.workspace_schermate where codice='test.module.screen')<>array['test_module_a'] then raise exception 'Module save changed screen areas'; end if;
 if (select count(*) from public.workspace_moduli_aree where modulo_codice='test_multi_module')<>2 then raise exception 'FK links missing'; end if;
 if (select revision from public.workspace_access_revision where id)<=before_revision then raise exception 'Access revision not refreshed'; end if;
 if not public.workspace_module_enabled_for_user(actor,'test_multi_module') then raise exception 'Second-area grant not effective'; end if;
 if public.workspace_screen_level_for_user(actor,'test.module.screen')='nessuno' then raise exception 'Linked module grant not effective'; end if;
 -- The multi-area gate must not bypass the existing department/module grant requirement.
 update public.workspace_moduli set sempre_disponibile=false,assegnabile_reparto=true where codice='test_multi_module';
 if public.workspace_module_enabled_for_user(actor,'test_multi_module') then raise exception 'Area bypassed module assignment'; end if;
 update public.workspace_moduli set sempre_disponibile=true,assegnabile_reparto=false where codice='test_multi_module';
 update public.workspace_moduli set area='workspace',descrizione='resync' where codice='test_multi_module';
 if (select aree from public.workspace_moduli where codice='test_multi_module')<>array['test_module_a','test_module_b'] then raise exception 'Sync overwrote areas'; end if;
 perform public.admin_save_workspace_module((payload-'aree')||jsonb_build_object('area','test_module_a'),array['test.module.screen'],null);
 if (select aree from public.workspace_moduli where codice='test_multi_module')<>array['test_module_a','test_module_b'] then raise exception 'Legacy save lost secondary areas'; end if;
 failed=false;
 -- Remove the user grant so only the module's SECOND area reference prevents deletion.
 delete from public.workspace_utenti_aree where utente_id=actor and area_codice='test_module_b';
 begin delete from public.workspace_aree where codice='test_module_b'; exception when foreign_key_violation then failed=true; end;
 if not failed then raise exception 'Referenced secondary area deleted'; end if;
 insert into public.workspace_utenti_aree(utente_id,area_codice) values(actor,'test_module_b');
 insert into public.workspace_eccezioni_utente(utente_id,ambito,codice,decisione) values(actor,'modulo','test_multi_module','nega');
 if public.workspace_module_enabled_for_user(actor,'test_multi_module') then raise exception 'Module denial bypassed'; end if;
 update public.workspace_eccezioni_utente set valida_fino_a=now()-interval '1 day' where utente_id=actor and codice='test_multi_module';
 if not public.workspace_module_enabled_for_user(actor,'test_multi_module') then raise exception 'Expired denial persisted'; end if;
 perform public.admin_save_workspace_module(payload||jsonb_build_object('aree',jsonb_build_array('test_module_a')),array['test.module.screen'],null);
 if public.workspace_module_enabled_for_user(actor,'test_multi_module') then raise exception 'Removed area still authorizes'; end if;
 if exists(select 1 from public.workspace_moduli_aree where modulo_codice='test_multi_module' and area_codice='test_module_b') then raise exception 'Stale FK association'; end if;
 update public.workspace_eccezioni_utente set decisione='consenti',valida_fino_a=null where utente_id=actor and codice='test_multi_module';
 if not public.workspace_module_enabled_for_user(actor,'test_multi_module') then raise exception 'Personal module grant stopped working'; end if;
 failed=false;
 begin perform public.admin_save_workspace_module(payload||jsonb_build_object('aree','[]'::jsonb),'{}',null); exception when raise_exception then failed=true; end;
 if not failed then raise exception 'Empty areas accepted'; end if;
 failed=false;
 begin perform public.admin_save_workspace_module(payload||jsonb_build_object('aree',jsonb_build_array('test_nonexistent')),'{}',null); exception when raise_exception then failed=true; end;
 if not failed then raise exception 'Unknown area accepted'; end if;
 perform set_config('request.jwt.claim.sub',auth_actor::text,true);
 failed=false;
 begin perform public.admin_save_workspace_module(payload,'{}',null); exception when insufficient_privilege then failed=true; end;
 if not failed then raise exception 'Non-admin changed module areas'; end if;
 snap=public.workspace_session_access();
 if snap->'module_area_codes'->'test_multi_module'<>jsonb_build_array('test_module_a') then raise exception 'Session omits multi areas'; end if;
 if snap->'module_areas'->>'test_multi_module'<>'test_module_a' then raise exception 'Legacy snapshot broken'; end if;
end $test$;

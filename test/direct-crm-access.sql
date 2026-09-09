-- Synthetic fixtures only; the runner substitutes pg_temp copies of the migration.
insert into pg_temp.ruoli(id,amministratore_workspace,livello_ai,livello_accesso)
values ('10000000-0000-4000-8000-000000000001',false,'analisi','lettura');
insert into pg_temp.utenti(id,ruolo_id,reparto_id,auth_user_id,attivo)
values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',true);
insert into pg_temp.workspace_moduli(codice,area,attivo,sempre_disponibile,assegnabile_reparto,provider,dipendenze,dipendenze_alternative,ordine)
select code,'crm',true,false,true,'workspace','{}','{}',0
from unnest(array['crm_brand_direct','crm_b2b','crm_online','crm_direct','crm',
 'crm_online_ecommerce','crm_online_mailing','crm_online_amazon','crm_online_adv','crm_ai','attivita']) code;
update pg_temp.workspace_moduli set dipendenze_alternative=array['crm_direct'],assegnabile_reparto=false where codice='crm';
update pg_temp.workspace_moduli set sempre_disponibile=true where codice='attivita';
-- Reproduce the historical catalog and role-only grant before applying the migration.
update pg_temp.workspace_moduli set dipendenze_alternative=array['crm_b2b','crm_online'] where codice='crm_brand_direct';
update pg_temp.workspace_moduli set dipendenze_alternative=array['crm_online_ecommerce','crm_online_mailing','crm_online_amazon','crm_online_adv'] where codice='crm_online';
insert into pg_temp.ruoli_moduli(ruolo_id,modulo,livello_accesso)
select '10000000-0000-4000-8000-000000000001',code,'scrittura'
from unnest(array['crm_brand_direct','crm_b2b','crm_online']) code;

-- MIGRATION_GOES_HERE

do $tests$
declare
 u uuid := '20000000-0000-4000-8000-000000000001';
 d uuid := '30000000-0000-4000-8000-000000000001';
 codes text[] := array['crm_brand_direct','crm_b2b','crm_online'];
 mask integer;
 i integer;
 expected boolean;
 rec record;
begin
 for mask in 0..7 loop
  delete from pg_temp.reparti_moduli;
  -- A container grant and all Online submodule grants must never open another channel.
  insert into pg_temp.reparti_moduli(reparto_id,modulo)
  select d,code from unnest(array['crm_direct','crm_online_ecommerce','crm_online_mailing','crm_online_amazon','crm_online_adv']) code;
  for i in 1..3 loop
   if (mask & (1 << (i-1))) <> 0 then
    insert into pg_temp.reparti_moduli(reparto_id,modulo) values(d,codes[i]);
   end if;
  end loop;
  for i in 1..3 loop
   expected := (mask & (1 << (i-1))) <> 0;
   if pg_temp.workspace_module_enabled_for_user(u,codes[i]) is distinct from expected then
    raise exception 'Independent combination % failed for %',mask,codes[i];
   end if;
  end loop;
  if pg_temp.workspace_module_enabled_for_user(u,'crm_direct') is distinct from (mask<>0)
    or pg_temp.workspace_module_enabled_for_user(u,'crm') is distinct from (mask<>0) then
   raise exception 'Container combination % failed',mask;
  end if;
  for rec in select codice from pg_temp.workspace_moduli where codice like 'crm_online_%' loop
   if pg_temp.workspace_module_enabled_for_user(u,rec.codice) is distinct from ((mask & 4)<>0) then
    raise exception 'Online submodule % failed for mask %',rec.codice,mask;
   end if;
  end loop;
  for rec in select * from pg_temp.workspace_inspect_module_access(u) loop
   if rec.allowed is distinct from pg_temp.workspace_module_enabled_for_user(u,rec.codice) then
    raise exception 'Inspector mismatch %',rec.codice;
   end if;
   if rec.codice=any(codes) and rec.allowed and rec.level <> 'scrittura' then
    raise exception 'Role level not retained';
   end if;
  end loop;
 end loop;

 -- Individual denies override department grants, and do not affect siblings.
 insert into pg_temp.workspace_eccezioni_utente(utente_id,ambito,codice,decisione)
 values(u,'modulo','crm_brand_direct','nega'),(u,'modulo','crm_online','nega');
 if pg_temp.workspace_module_enabled_for_user(u,'crm_brand_direct')
  or pg_temp.workspace_module_enabled_for_user(u,'crm_online_ecommerce')
  or not pg_temp.workspace_module_enabled_for_user(u,'crm_b2b') then raise exception 'Deny isolation failed'; end if;
 insert into pg_temp.workspace_eccezioni_utente(utente_id,ambito,codice,decisione)
 values(u,'modulo','crm_online_ecommerce','consenti');
 if pg_temp.workspace_module_enabled_for_user(u,'crm_online_ecommerce') then raise exception 'Child allow bypassed parent deny'; end if;
 delete from pg_temp.workspace_eccezioni_utente;
 delete from pg_temp.reparti_moduli;
 insert into pg_temp.workspace_eccezioni_utente(utente_id,ambito,codice,decisione,livello_accesso)
 values(u,'modulo','crm_brand_direct','consenti','amministrazione');
 if not pg_temp.workspace_module_enabled_for_user(u,'crm_brand_direct')
  or pg_temp.workspace_module_enabled_for_user(u,'crm_b2b')
  or pg_temp.workspace_module_enabled_for_user(u,'crm_online') then raise exception 'Personal allow isolation failed'; end if;
 if (select level from pg_temp.workspace_inspect_module_access(u) where codice='crm_brand_direct') <> 'amministrazione' then
  raise exception 'Exception level missing';
 end if;
 update pg_temp.workspace_eccezioni_utente set valida_fino_a=now()-interval '1 day';
 if pg_temp.workspace_module_enabled_for_user(u,'crm_brand_direct') then raise exception 'Expired exception applied'; end if;
 delete from pg_temp.workspace_eccezioni_utente;

 -- Multiple departments are unioned, but still per module.
 insert into pg_temp.utenti_reparti(utente_id,reparto_id) values(u,'30000000-0000-4000-8000-000000000002');
 insert into pg_temp.reparti_moduli(reparto_id,modulo) values('30000000-0000-4000-8000-000000000002','crm_b2b');
 if not pg_temp.workspace_module_enabled_for_user(u,'crm_b2b')
  or pg_temp.workspace_module_enabled_for_user(u,'crm_brand_direct') then raise exception 'Multi-department failed'; end if;
 perform set_config('test.crm_area','denied',true);
 if pg_temp.workspace_module_enabled_for_user(u,'crm_b2b') then raise exception 'Area deny bypassed'; end if;
 perform set_config('test.crm_area','allowed',true);
 update pg_temp.workspace_moduli set attivo=false where codice='crm_b2b';
 if pg_temp.workspace_module_enabled_for_user(u,'crm_b2b') then raise exception 'Inactive module allowed'; end if;
 update pg_temp.workspace_moduli set attivo=true where codice='crm_b2b';
 update pg_temp.utenti set attivo=false where id=u;
 if pg_temp.workspace_module_enabled_for_user(u,'crm_b2b') then raise exception 'Inactive user allowed'; end if;
 update pg_temp.utenti set attivo=true where id=u;
 if pg_temp.workspace_module_enabled_for_user('20000000-0000-4000-8000-000000000099','crm_b2b') then raise exception 'Unknown user allowed'; end if;
 if not pg_temp.workspace_module_enabled_for_user(u,'attivita') then raise exception 'Unrelated module regression'; end if;

 -- Admin remains full access. The inspector itself is administrator-only.
 update pg_temp.ruoli set amministratore_workspace=true;
 for i in 1..3 loop
  if not pg_temp.workspace_module_enabled_for_user(u,codes[i]) then raise exception 'Admin access failed'; end if;
 end loop;
 perform set_config('test.crm_inspector_admin','false',true);
 begin
  perform * from pg_temp.workspace_inspect_module_access(u);
  raise exception 'Inspector allowed unauthorized caller';
 exception when insufficient_privilege then null;
 end;
 if (select count(*) from pg_temp.ruoli_moduli) <> 3 then raise exception 'Role history changed'; end if;
end;
$tests$;

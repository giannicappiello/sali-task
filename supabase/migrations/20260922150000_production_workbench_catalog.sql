begin;

-- Separate assignable commercial module; no user, role or department is granted access here.
insert into public.workspace_moduli
 (codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine)
values ('production_progress','Ordini e avanzamento','Monitoraggio commerciale OCT, RdP e singole lavorazioni.',
 'modulo','produzione','/produzione/ordini-avanzamento','workspace',false,true,true,false,true,205)
on conflict (codice) do nothing;

insert into public.workspace_schermate
 (codice,nome,descrizione,provider,area,percorso,chiave_componente,protetta,attiva,ordine,metadati)
values ('workspace.production.progress','Ordini e avanzamento','Monitoraggio OCT, richieste produttive e lavorazioni collegate.',
 'workspace','produzione','/produzione/ordini-avanzamento','ordini-avanzamento',false,true,5,
 '{"required_permissions":["rdp.view"],"local_production_catalog_v1":true}'::jsonb)
on conflict (codice) do nothing;

insert into public.workspace_moduli_schermate
 (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
select m.codice,s.codice,5,m.codice='production_progress',true
from public.workspace_moduli m cross join public.workspace_schermate s
where m.codice in ('progremes','production_progress') and s.codice='workspace.production.progress'
on conflict (modulo_codice,schermata_codice) do nothing;

-- MES creates its module/screen through the existing catalog sync only after installation.
-- Make the new module selectable in the common department editor on first discovery.
create function public.production_workbench_catalog_defaults() returns trigger
language plpgsql set search_path=public as $$
begin
 if new.codice='progremes_planningproduction' then
  new.assegnabile_reparto=true;
  new.configurabile_ruolo=true;
 end if;
 return new;
end $$;
create trigger production_workbench_catalog_defaults before insert on public.workspace_moduli
for each row execute function public.production_workbench_catalog_defaults();

update public.workspace_moduli set assegnabile_reparto=true,configurabile_ruolo=true
where codice='progremes_planningproduction';
commit;

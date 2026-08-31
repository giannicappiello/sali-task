begin;

create or replace function public.enforce_workspace_private_documents_module()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.codice = 'progremes_formule' then
    new.nome := 'Documenti Private';
    new.descrizione := 'Archivio Workspace protetto per documenti di articolo, produzione e lotto conservati sul NAS.';
    new.tipo := 'modulo';
    new.area := 'documentale';
    new.percorso := '/documentation/private';
    new.provider := 'workspace';
    new.mostra_menu := true;
    new.attivo := true;
    new.icona := 'file-archive';
    new.aggiornato_il := now();
  end if;
  return new;
end
$$;

drop trigger if exists enforce_workspace_private_documents_module on public.workspace_moduli;
create trigger enforce_workspace_private_documents_module
before insert or update on public.workspace_moduli
for each row execute function public.enforce_workspace_private_documents_module();

update public.workspace_moduli
set nome = nome
where codice = 'progremes_formule';

update public.workspace_moduli_schermate
set visibile_menu = false,
    predefinita = false
where modulo_codice = 'progremes_formule';

update public.permessi
set modulo = 'progremes_formule'
where codice in (
  'documentation.private.view',
  'documentation.private.upload',
  'documentation.private.manage_access'
);

commit;

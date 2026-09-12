begin;

-- Keep the Workspace document route, but respect the administrator's area.
-- Do not move existing modules/screens or change any grants.
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

commit;

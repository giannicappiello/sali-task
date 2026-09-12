begin;

-- Allow the administrator to delete this area from the settings panel.
-- Existing RESTRICT foreign keys on module/screen.area still require it to
-- be empty. No area, grant, module or screen is deleted by this migration.
update public.workspace_aree
set protetta = false, aggiornata_il = now()
where codice = 'amministrazione' and protetta = true;

commit;

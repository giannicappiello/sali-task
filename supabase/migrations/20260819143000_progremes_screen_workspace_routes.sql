begin;

update public.workspace_schermate
set percorso = '/produzione/' || replace(codice, '/', '%2F')
where provider = 'progremes'
  and percorso = '/progremes';

commit;

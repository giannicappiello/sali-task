begin;

update public.workspace_moduli_schermate
set predefinita = false
where modulo_codice in ('ordini_pr', 'ordini_ph');

update public.workspace_moduli
set
  tipo = 'contenitore',
  percorso = '/moduli/' || codice,
  aggiornato_il = now()
where codice in ('ordini_pr', 'ordini_ph');

commit;

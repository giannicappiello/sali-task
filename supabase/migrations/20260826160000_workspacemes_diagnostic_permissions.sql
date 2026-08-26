begin;

insert into public.permessi(codice, descrizione, modulo)
values
  ('diagnostics.view', 'Visualizza il Centro Diagnostico WorkspaceMES', 'progremes'),
  ('diagnostics.manage', 'Gestisce acknowledge, risoluzione e ignore diagnostici', 'progremes'),
  ('rdp.view', 'Visualizza RdP e analisi produttive', 'progremes'),
  ('rdp.decide', 'Registra decisioni operative sulle RdP', 'progremes'),
  ('rdp.overallocate', 'Autorizza attribuzioni oltre la quantità OCT', 'progremes'),
  ('production.mapping.manage', 'Gestisce mapping commerciali e produttivi', 'progremes'),
  ('production.execute', 'Esegue mutazioni produttive WorkspaceMES', 'progremes'),
  ('lots.manage', 'Gestisce creazione e associazione lotti WorkspaceMES', 'progremes')
on conflict (codice) do update
set descrizione = excluded.descrizione,
    modulo = excluded.modulo;

-- Nessuna assegnazione automatica: i permessi produttivi sono concessi
-- esplicitamente dall'amministratore. Il ruolo amministratore mantiene il
-- proprio override già previsto dal modello di autorizzazione Workspace.

commit;

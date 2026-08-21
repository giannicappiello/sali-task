insert into public.permessi (codice, descrizione, modulo)
values ('integrations.sync.document_series', 'Sincronizza serie documenti', 'integrazioni')
on conflict (codice) do update
set descrizione = excluded.descrizione,
    modulo = excluded.modulo;

begin;
insert into public.permessi(codice, descrizione, modulo)
values ('rdp.create', 'Crea e invia richieste di produzione WorkspaceMES', 'progremes')
on conflict (codice) do update set descrizione = excluded.descrizione, modulo = excluded.modulo;
commit;

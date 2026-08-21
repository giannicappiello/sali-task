begin;

update public.mexal_fatture_vendita
set causale_magazzino_codice = coalesce(
  nullif(btrim(causale_magazzino_codice), ''),
  nullif(btrim(dati_mexal -> 'id_causale' -> 0 ->> 1), '')
)
where nullif(btrim(causale_magazzino_codice), '') is null
  and nullif(btrim(dati_mexal -> 'id_causale' -> 0 ->> 1), '') is not null;

update public.mexal_fatture_vendita
set causale_magazzino_descrizione = case btrim(causale_magazzino_codice)
  when '1' then 'Vendita diretta'
  when '2' then 'Vendita Online'
  when '3' then 'Vendita C/Terzi'
  when '10' then 'Campionatura'
  else causale_magazzino_descrizione
end
where btrim(causale_magazzino_codice) in ('1', '2', '3', '10');

update public.ordini_documenti_mexal
set causale_magazzino_codice = coalesce(
  nullif(btrim(causale_magazzino_codice), ''),
  nullif(btrim(dati_mexal -> 'id_causale' -> 0 ->> 1), '')
)
where nullif(btrim(causale_magazzino_codice), '') is null
  and nullif(btrim(dati_mexal -> 'id_causale' -> 0 ->> 1), '') is not null;

update public.ordini_documenti_mexal
set causale_magazzino_descrizione = case btrim(causale_magazzino_codice)
  when '1' then 'Vendita diretta'
  when '2' then 'Vendita Online'
  when '3' then 'Vendita C/Terzi'
  when '10' then 'Campionatura'
  else causale_magazzino_descrizione
end
where btrim(causale_magazzino_codice) in ('1', '2', '3', '10');

commit;

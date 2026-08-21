begin;

update public.mexal_fatture_vendita_righe
set prezzo_netto_unitario = 0,
    sconto_percentuale_equivalente = 100,
    valore_netto = 0,
    valore_netto_origine = 'calcolato_da_sconto'
where upper(regexp_replace(btrim(coalesce(sconto, '')), '\s+', '', 'g')) in ('SC.MERCE', 'SCMERCE')
  and valore_netto is null;

commit;

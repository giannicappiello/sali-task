begin;

-- Gli OCT appartengono esclusivamente a OrdiniPrivate. La correzione usa
-- l'origine autorevole dell'importatore e il documento Mexal già certificato.
update public.ordini_testate
set modulo_ordini = 'private'
where origine = 'mexal_oct'
  and modulo_ordini is distinct from 'private';

update public.ordini_testate t
set modulo_ordini = 'private'
where modulo_ordini is distinct from 'private'
  and exists (
    select 1
    from public.ordini_documenti_mexal d
    where d.ordine_id = t.id
      and d.tipo_documento = 'OCT'
      and d.modulo = 'ORDINIPRIVATE'
  );

-- Completa le descrizioni denormalizzate senza sovrascrivere dati già presenti.
update public.ordini_testate t
set ragione_sociale_cliente = c.ragione_sociale,
    codice_agente_mexal = coalesce(nullif(btrim(t.codice_agente_mexal), ''), c.codice_agente_mexal)
from public.ordini_clienti_cache c
where c.codice_cliente = t.codice_cliente
  and (
    nullif(btrim(t.ragione_sociale_cliente), '') is null
    or btrim(t.ragione_sociale_cliente) = btrim(t.codice_cliente)
    or nullif(btrim(t.codice_agente_mexal), '') is null
  );

commit;

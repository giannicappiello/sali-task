begin;

alter table public.ordini_impianti_componenti
  add column if not exists prezzo_unitario numeric(14,4);

alter table public.ordini_impianti_componenti
  drop constraint if exists ordini_impianti_componenti_prezzo_unitario_check;

alter table public.ordini_impianti_componenti
  add constraint ordini_impianti_componenti_prezzo_unitario_check
  check (prezzo_unitario is null or prezzo_unitario >= 0);

comment on column public.ordini_impianti_componenti.prezzo_unitario is
  'Prezzo unitario configurato per il singolo prodotto nell impianto; indipendente dal listino Mexal successivo.';

-- Congela il listino corrente sui componenti esistenti. Se il prodotto non ha
-- ancora un prezzo, il valore resta nullo e la UI continua a mostrare il listino.
update public.ordini_impianti_componenti component
set prezzo_unitario = product.prezzo_listino
from public.ordini_prodotti_cache product
where product.codice_articolo = component.codice_articolo
  and component.prezzo_unitario is null
  and product.prezzo_listino is not null
  and product.prezzo_listino >= 0;

alter table public.ordini_testate
  drop constraint if exists ordini_testate_stato_check;

alter table public.ordini_testate
  add constraint ordini_testate_stato_check
  check (stato in ('bozza', 'aperto', 'in_corso', 'confermato', 'spedito', 'evaso', 'annullato'));

-- I PH già trattati come sincronizzati/riconciliati erano in realtà ordini
-- interni spediti. Le bozze restano bozze e lo storico non viene eliminato.
update public.ordini_testate orders
set stato = 'spedito',
    stato_sincronizzazione = 'non_inviato',
    errore_sincronizzazione = null,
    arresto_sync_richiesto = false,
    arresto_sync_richiesto_il = null,
    arresto_sync_richiesto_da = null,
    sync_token = null
where lower(coalesce(orders.modulo_ordini, '')) = 'ph'
  and lower(coalesce(orders.stato, '')) <> 'bozza'
  and (
    coalesce(orders.stato_sincronizzazione, 'non_inviato') not in ('non_inviato', 'non_avviato')
    or exists (
      select 1
      from public.ordini_documenti_mexal document
      where document.ordine_id = orders.id
        and document.modulo = 'ORDINIPH'
    )
  );

commit;

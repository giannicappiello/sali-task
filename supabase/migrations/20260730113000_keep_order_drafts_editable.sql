begin;

-- Le bozze non devono ereditare uno stato terminale dalla sola presenza delle
-- quantità preparate nelle righe. I documenti Mexal reali restano esclusi.
update public.ordini_testate as ordine
set stato_sincronizzazione = 'non_avviato',
    errore_sincronizzazione = null,
    arresto_sync_richiesto = false,
    arresto_sync_richiesto_il = null,
    arresto_sync_richiesto_da = null,
    sincronizzazione_iniziata_il = null,
    sincronizzazione_heartbeat_il = null,
    sync_token = null
where lower(coalesce(ordine.stato, '')) = 'bozza'
  and not exists (
    select 1
    from public.ordini_documenti_mexal as documento
    where documento.ordine_id = ordine.id
      and nullif(trim(documento.numero), '') is not null
  )
  and ordine.numero_ocm is null
  and ordine.numero_ocx is null
  and ordine.numero_oci is null
  and coalesce(ordine.stato_sincronizzazione, '') not in ('non_avviato', 'non_inviato');

commit;

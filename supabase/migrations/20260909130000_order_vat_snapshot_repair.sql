-- Preserve the VAT/economic snapshots previously lost when saving an order.
-- No historical rows are deleted or backfilled by this migration.
create or replace function public.aggiorna_ordine_operativo(
  p_ordine_id uuid,
  p_testata jsonb,
  p_righe jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.ordini_righe%rowtype;
  v_codice_pagamento_text text;
  v_codice_pagamento integer;
  v_codice_listino_text text;
  v_codice_listino integer;
begin
  perform 1
  from public.ordini_testate
  where id = p_ordine_id
  for update;

  if not found then
    raise exception 'Ordine non trovato' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.ordini_testate
    where id = p_ordine_id
      and (numero_ocm is not null or numero_ocx is not null or numero_oci is not null)
  ) or exists (
    select 1
    from public.ordini_documenti_mexal
    where ordine_id = p_ordine_id
      and nullif(trim(numero), '') is not null
  ) then
    raise exception 'L’ordine non può essere modificato perché esiste già un documento Mexal.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.ordini_testate
    where id = p_ordine_id
      and stato_sincronizzazione in ('non_inviato','non_avviato','errore','annullato','arrestato')
  ) then
    raise exception 'Lo stato della sincronizzazione non consente la modifica.'
      using errcode = 'P0001';
  end if;

  v_codice_pagamento_text := nullif(btrim(p_testata->>'codice_pagamento'), '');
  v_codice_listino_text := nullif(btrim(p_testata->>'codice_listino'), '');

  if v_codice_pagamento_text is not null
     and v_codice_pagamento_text !~ '^[0-9]+$' then
    raise exception 'Codice pagamento non valido.' using errcode = '22023';
  end if;

  if v_codice_listino_text is not null
     and v_codice_listino_text !~ '^[0-9]+$' then
    raise exception 'Codice listino non valido.' using errcode = '22023';
  end if;

  v_codice_pagamento := v_codice_pagamento_text::integer;
  v_codice_listino := v_codice_listino_text::integer;

  update public.ordini_testate
  set
    data_ordine = (p_testata->>'data_ordine')::date,
    stato = coalesce(p_testata->>'stato', 'bozza'),
    codice_cliente = p_testata->>'codice_cliente',
    ragione_sociale_cliente = p_testata->>'ragione_sociale_cliente',
    codice_agente_mexal = nullif(p_testata->>'codice_agente_mexal', ''),
    codice_pagamento = v_codice_pagamento,
    descrizione_pagamento = nullif(p_testata->>'descrizione_pagamento', ''),
    codice_listino = v_codice_listino,
    indirizzo_spedizione = nullif(p_testata->>'indirizzo_spedizione', ''),
    commenti = nullif(p_testata->>'commenti', ''),
    totale = coalesce((p_testata->>'totale')::numeric, 0),
    partita_iva = case when p_testata ? 'partita_iva' then nullif(p_testata->>'partita_iva', '') else partita_iva end,
    tipo_ordine = coalesce(p_testata->>'tipo_ordine', tipo_ordine),
    totale_imponibile = coalesce((p_testata->>'totale_imponibile')::numeric, totale_imponibile),
    totale_iva = coalesce((p_testata->>'totale_iva')::numeric, totale_iva),
    totale_documento = coalesce((p_testata->>'totale_documento')::numeric, totale_documento),
    note_mexal = nullif(p_testata->>'note_mexal', ''),
    stato_sincronizzazione = 'non_avviato',
    errore_sincronizzazione = null,
    arresto_sync_richiesto = false,
    arresto_sync_richiesto_il = null,
    arresto_sync_richiesto_da = null,
    sincronizzazione_iniziata_il = null,
    sincronizzazione_heartbeat_il = null,
    sync_token = null
  where id = p_ordine_id;

  delete from public.ordini_righe
  where ordine_id = p_ordine_id;

  for r in
    select *
    from jsonb_populate_recordset(null::public.ordini_righe, p_righe)
  loop
    insert into public.ordini_righe (
      ordine_id,
      codice_articolo,
      descrizione,
      quantita,
      quantita_ocm,
      quantita_ocx,
      quantita_oci,
      prezzo_listino,
      codice_iva_mexal,
      aliquota_iva,
      imponibile_riga,
      iva_riga,
      sconto_percentuale,
      sconto_commerciale,
      sconto_pagamento,
      origine_prezzo,
      origine_sconto,
      regola_prezzo_id,
      regola_sconto_id,
      regola_pagamento_id,
      dettaglio_calcolo,
      prezzo_netto,
      totale_riga,
      provvigione_percentuale,
      provvigione_regola_id,
      provvigione_dettaglio_calcolo,
      provvigione_calcolata_il
    ) values (
      p_ordine_id,
      r.codice_articolo,
      r.descrizione,
      r.quantita,
      coalesce(r.quantita_ocm, 0),
      coalesce(r.quantita_ocx, 0),
      coalesce(r.quantita_oci, 0),
      r.prezzo_listino,
      nullif(btrim(r.codice_iva_mexal), ''),
      r.aliquota_iva,
      r.imponibile_riga,
      r.iva_riga,
      r.sconto_percentuale,
      r.sconto_commerciale,
      r.sconto_pagamento,
      r.origine_prezzo,
      r.origine_sconto,
      r.regola_prezzo_id,
      r.regola_sconto_id,
      r.regola_pagamento_id,
      coalesce(r.dettaglio_calcolo, '{}'::jsonb),
      r.prezzo_netto,
      r.totale_riga,
      r.provvigione_percentuale,
      r.provvigione_regola_id,
      r.provvigione_dettaglio_calcolo,
      r.provvigione_calcolata_il
    );
  end loop;
end;
$$;

revoke all on function public.aggiorna_ordine_operativo(uuid,jsonb,jsonb) from public;
revoke all on function public.aggiorna_ordine_operativo(uuid,jsonb,jsonb) from anon;
revoke all on function public.aggiorna_ordine_operativo(uuid,jsonb,jsonb) from authenticated;
grant execute on function public.aggiorna_ordine_operativo(uuid,jsonb,jsonb) to service_role;

-- Repair missing VAT only under the active synchronization lock. Existing
-- snapshots and already transmitted documents are never overwritten.
create or replace function public.salva_iva_ordine_in_sync(
  p_ordine_id uuid, p_sync_token uuid, p_aggiornamenti jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  perform 1 from public.ordini_testate
    where id = p_ordine_id and sync_token = p_sync_token
      and not coalesce(arresto_sync_richiesto, false)
    for update;
  if not found then
    raise exception 'Sincronizzazione ordine non attiva.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_aggiornamenti) is distinct from 'array' then
    raise exception 'Aggiornamenti IVA non validi.' using errcode = '22023';
  end if;
  select count(distinct r.id) into v_count
  from jsonb_to_recordset(p_aggiornamenti) as u(id uuid, codice_iva_mexal text, aliquota_iva numeric)
  join public.ordini_righe r on r.id = u.id and r.ordine_id = p_ordine_id
  where nullif(btrim(u.codice_iva_mexal), '') is not null;
  if v_count <> jsonb_array_length(p_aggiornamenti) then
    raise exception 'Righe IVA non valide per questo ordine.' using errcode = '22023';
  end if;
  update public.ordini_righe r
    set codice_iva_mexal = btrim(u.codice_iva_mexal), aliquota_iva = u.aliquota_iva
  from jsonb_to_recordset(p_aggiornamenti) as u(id uuid, codice_iva_mexal text, aliquota_iva numeric)
  where r.id = u.id and r.ordine_id = p_ordine_id
    and nullif(btrim(r.codice_iva_mexal), '') is null;
end;
$$;
revoke all on function public.salva_iva_ordine_in_sync(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.salva_iva_ordine_in_sync(uuid,uuid,jsonb) to service_role;

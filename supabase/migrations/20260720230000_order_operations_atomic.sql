-- Server-only atomic operations.  PostgreSQL rolls the entire function back if
-- any replacement line cannot be inserted, so an order can never lose its rows.
create or replace function public.aggiorna_ordine_operativo(p_ordine_id uuid, p_testata jsonb, p_righe jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r public.ordini_righe%rowtype;
begin
  perform 1 from public.ordini_testate where id = p_ordine_id for update;
  if not found then raise exception 'Ordine non trovato' using errcode = 'P0002'; end if;
  if exists (select 1 from public.ordini_testate where id = p_ordine_id and (numero_ocm is not null or numero_ocx is not null or numero_oci is not null))
    or exists (select 1 from public.ordini_documenti_mexal where ordine_id = p_ordine_id and nullif(trim(numero), '') is not null) then
    raise exception 'L’ordine non può essere modificato perché esiste già un documento Mexal.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.ordini_testate where id = p_ordine_id and stato_sincronizzazione in ('non_inviato','non_avviato','errore','annullato','arrestato')) then
    raise exception 'Lo stato della sincronizzazione non consente la modifica.' using errcode = 'P0001';
  end if;
  update public.ordini_testate set
    data_ordine = (p_testata->>'data_ordine')::date, stato = coalesce(p_testata->>'stato', 'bozza'),
    codice_cliente = p_testata->>'codice_cliente', ragione_sociale_cliente = p_testata->>'ragione_sociale_cliente',
    codice_agente_mexal = nullif(p_testata->>'codice_agente_mexal',''), codice_pagamento = nullif(p_testata->>'codice_pagamento',''),
    descrizione_pagamento = nullif(p_testata->>'descrizione_pagamento',''), codice_listino = nullif(p_testata->>'codice_listino',''),
    indirizzo_spedizione = nullif(p_testata->>'indirizzo_spedizione',''), commenti = nullif(p_testata->>'commenti',''),
    totale = coalesce((p_testata->>'totale')::numeric, 0), note_mexal = nullif(p_testata->>'note_mexal',''),
    stato_sincronizzazione = 'non_avviato', errore_sincronizzazione = null, arresto_sync_richiesto = false, arresto_sync_richiesto_il = null,
    arresto_sync_richiesto_da = null, sincronizzazione_iniziata_il = null, sincronizzazione_heartbeat_il = null, sync_token = null
  where id = p_ordine_id;
  delete from public.ordini_righe where ordine_id = p_ordine_id;
  for r in select * from jsonb_populate_recordset(null::public.ordini_righe, p_righe) loop
    insert into public.ordini_righe (ordine_id,codice_articolo,descrizione,quantita,quantita_ocm,quantita_ocx,quantita_oci,prezzo_listino,sconto_percentuale,sconto_commerciale,sconto_pagamento,origine_prezzo,origine_sconto,regola_prezzo_id,regola_sconto_id,regola_pagamento_id,dettaglio_calcolo,prezzo_netto,totale_riga)
    values (p_ordine_id,r.codice_articolo,r.descrizione,r.quantita,0,0,0,r.prezzo_listino,r.sconto_percentuale,r.sconto_commerciale,r.sconto_pagamento,r.origine_prezzo,r.origine_sconto,r.regola_prezzo_id,r.regola_sconto_id,r.regola_pagamento_id,coalesce(r.dettaglio_calcolo,'{}'::jsonb),r.prezzo_netto,r.totale_riga);
  end loop;
end $$;

create or replace function public.elimina_ordine_operativo(p_ordine_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.ordini_testate where id = p_ordine_id for update;
  if not found then raise exception 'Ordine non trovato' using errcode = 'P0002'; end if;
  if exists (select 1 from public.ordini_testate where id=p_ordine_id and (numero_ocm is not null or numero_ocx is not null or numero_oci is not null)) or exists (select 1 from public.ordini_documenti_mexal where ordine_id=p_ordine_id and nullif(trim(numero),'') is not null) then raise exception 'L’ordine non può essere eliminato perché esiste già un documento Mexal.' using errcode = 'P0001'; end if;
  delete from public.ordini_sync_mexal_log where ordine_id=p_ordine_id;
  delete from public.ordini_documenti_mexal where ordine_id=p_ordine_id;
  delete from public.ordini_righe where ordine_id=p_ordine_id;
  delete from public.mexal_sync_runs where metadata @> jsonb_build_object('order_id',p_ordine_id::text);
  delete from public.ordini_testate where id=p_ordine_id;
end $$;
revoke all on function public.aggiorna_ordine_operativo(uuid,jsonb,jsonb) from public;
revoke all on function public.elimina_ordine_operativo(uuid) from public;
revoke all on function public.aggiorna_ordine_operativo(uuid,jsonb,jsonb) from anon;
revoke all on function public.aggiorna_ordine_operativo(uuid,jsonb,jsonb) from authenticated;
revoke all on function public.elimina_ordine_operativo(uuid) from anon;
revoke all on function public.elimina_ordine_operativo(uuid) from authenticated;
grant execute on function public.aggiorna_ordine_operativo(uuid,jsonb,jsonb) to service_role;
grant execute on function public.elimina_ordine_operativo(uuid) to service_role;

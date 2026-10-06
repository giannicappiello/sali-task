begin;
set local lock_timeout='5s';
alter table public.ordini_righe add column iva_non_applicata boolean not null default false;
alter table public.ordini_testate add column versione_conferma integer not null default 0;
alter table public.ordini_email_invio add column versione_conferma integer not null default 0;
update public.ordini_testate set versione_conferma=1 where confermato_at is not null;
update public.ordini_email_invio q set versione_conferma=o.versione_conferma
  from public.ordini_testate o where o.id=q.ordine_id;
alter table public.ordini_email_invio drop constraint ordini_email_invio_idempotency_key;
alter table public.ordini_email_invio add constraint ordini_email_invio_idempotency_key
  unique(ordine_id,evento,destinatario,versione_conferma);

-- Every insertion/update derives the policy from the authoritative customer.
-- Historical and imported documents are not rewritten by the migration.
create or replace function public.order_line_customer_vat_policy()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_country text;
begin
  select upper(btrim(c.paese)) into v_country from public.ordini_testate o
    join public.ordini_clienti_cache c on c.codice_cliente=o.codice_cliente
    where o.id=new.ordine_id and coalesce(o.origine,'')<>'mexal_oct';
  new.iva_non_applicata := coalesce(v_country<>'' and v_country not in ('IT','ITA','ITALIA','ITALY','380'),false);
  if new.iva_non_applicata then
    new.codice_iva_mexal := null; new.aliquota_iva := null; new.iva_riga := 0;
    new.totale_riga := coalesce(new.imponibile_riga,round(new.prezzo_netto*new.quantita,2));
    if new.riga_spedizione then
      new.dettaglio_calcolo := coalesce(new.dettaglio_calcolo,'{}'::jsonb)||jsonb_build_object('ripartizione_iva','[]'::jsonb);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.order_line_customer_vat_policy() from public,anon,authenticated;
create trigger ordini_righe_customer_vat_policy before insert or update on public.ordini_righe
  for each row execute function public.order_line_customer_vat_policy();

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
  v_previously_confirmed boolean;
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

  select stato='aperto' and confermato_at is not null into v_previously_confirmed
    from public.ordini_testate where id=p_ordine_id;
  if v_previously_confirmed then
    update public.ordini_email_invio set stato='cancelled',last_error='Ordine modificato: attesa nuova conferma'
      where ordine_id=p_ordine_id and stato in ('queued','retry','failed');
    -- Release the old reservation before replacing lines; confirmation reserves
    -- the new quantities once, including when the edit is saved as a draft.
    for r in select * from public.ordini_righe where ordine_id=p_ordine_id
      and not riga_descrittiva and not riga_spedizione
    loop
      update public.ordini_prodotti_cache set
        disponibilita=coalesce(disponibilita,0)+r.quantita,
        impegnato=greatest(0,coalesce(impegnato,0)-r.quantita)
      where codice_articolo=r.codice_articolo;
    end loop;
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
      riga_spedizione,
      riga_descrittiva,
      mexal_posizione,
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
      coalesce(r.riga_spedizione, false),
      coalesce(r.riga_descrittiva, false),
      r.mexal_posizione,
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
  perform public.applica_spedizione_ordine(p_ordine_id);
end;
$$;

revoke all on function public.aggiorna_ordine_operativo(uuid,jsonb,jsonb) from public;
revoke all on function public.aggiorna_ordine_operativo(uuid,jsonb,jsonb) from anon;
revoke all on function public.aggiorna_ordine_operativo(uuid,jsonb,jsonb) from authenticated;
grant execute on function public.aggiorna_ordine_operativo(uuid,jsonb,jsonb) to service_role;



create or replace function public.conferma_ordine_workspace(p_ordine_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r record;
begin
  perform 1 from public.ordini_testate where id=p_ordine_id and stato='bozza' for update;
  if not found then raise exception 'Ordine non trovato o già confermato'; end if;
  -- Keep caller visibility/ownership enforcement in the existing database RLS
  -- and customer boundary triggers when confirming a Private draft.
  perform public.applica_spedizione_ordine(p_ordine_id);
  update public.ordini_testate set stato='aperto',confermato_at=now(),versione_conferma=versione_conferma+1,
    note_mexal=coalesce(note_mexal,'Workspace n. '||id::text),
    note=coalesce(note,'Workspace n. '||id::text),updated_at=now() where id=p_ordine_id;
  for r in select codice_articolo,sum(quantita) quantita from public.ordini_righe
    where ordine_id=p_ordine_id and not riga_descrittiva and not riga_spedizione group by codice_articolo
  loop
    update public.ordini_prodotti_cache set disponibilita=greatest(0,coalesce(disponibilita,0)-r.quantita),
      impegnato=coalesce(impegnato,0)+r.quantita,sincronizzato_il=now() where codice_articolo=r.codice_articolo;
  end loop;
end;
$$;

notify pgrst,'reload schema';
commit;

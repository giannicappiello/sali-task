begin;
set local lock_timeout = '5s';

alter table public.ordini_moduli_configurazione
  add column importo_minimo_porto_franco numeric(12,2) not null default 0 check (importo_minimo_porto_franco >= 0 and importo_minimo_porto_franco <> 'NaN'::numeric),
  add column addebito_spedizione numeric(12,2) not null default 0 check (addebito_spedizione >= 0 and addebito_spedizione <> 'NaN'::numeric);
alter table public.ordini_testate
  add column importo_minimo_porto_franco numeric(12,2),
  add column addebito_spedizione numeric(12,2);
alter table public.ordini_righe add column riga_spedizione boolean not null default false;
alter table public.ordini_righe add constraint ordini_righe_spedizione_non_articolo
  check (not riga_spedizione or (riga_descrittiva and codice_articolo is null and quantita = 1
    and quantita_ocm = 0 and quantita_ocx = 0 and quantita_oci = 0));
create unique index ordini_righe_unica_spedizione on public.ordini_righe(ordine_id) where riga_spedizione;

-- Server-side recalculation before confirmation and after atomic edits. Imported
-- OCT and already transmitted documents are preserved. No historical backfill.
create or replace function public.applica_spedizione_ordine(p_ordine_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o public.ordini_testate%rowtype;
  c public.ordini_moduli_configurazione%rowtype;
  v_net numeric := 0;
  v_fee numeric := 0;
  v_vat numeric := 0;
  v_share numeric;
  v_allocated numeric := 0;
  v_basis numeric;
  v_groups integer;
  v_index integer := 0;
  v_split jsonb := '[]'::jsonb;
  v_tax_groups jsonb;
  v_kind text;
  g record;
begin
  select * into o from public.ordini_testate where id=p_ordine_id for update;
  if not found then raise exception 'Ordine non trovato' using errcode='P0002'; end if;
  if o.origine = 'mexal_oct' or o.numero_ocm is not null or o.numero_ocx is not null
    or o.numero_oci is not null or o.numero_oct is not null
    or exists(select 1 from public.ordini_documenti_mexal where ordine_id=p_ordine_id and nullif(btrim(numero),'') is not null) then
    return;
  end if;
  select * into c from public.ordini_moduli_configurazione where modulo_ordini=coalesce(o.modulo_ordini,'prof');
  delete from public.ordini_righe where ordine_id=p_ordine_id and riga_spedizione;
  select coalesce(sum(coalesce(imponibile_riga,round(prezzo_netto*quantita,2))),0) into v_net
    from public.ordini_righe where ordine_id=p_ordine_id and not riga_descrittiva;
  if v_net < coalesce(c.importo_minimo_porto_franco,0) and coalesce(c.addebito_spedizione,0)>0
    and exists(select 1 from public.ordini_righe where ordine_id=p_ordine_id and not riga_descrittiva) then
    v_fee := c.addebito_spedizione;
    v_kind := case
      when coalesce(o.modulo_ordini,'prof') in ('ph','private') then null
      when exists(select 1 from public.ordini_righe where ordine_id=p_ordine_id and not riga_descrittiva and (upper(codice_articolo) like 'IMP%' or (coalesce(o.tipo_ordine,'standard')<>'prenotazione' and quantita_ocm>0))) then 'OCM'
      when o.tipo_ordine='prenotazione' then 'OCI'
      when exists(select 1 from public.ordini_righe where ordine_id=p_ordine_id and not riga_descrittiva and quantita_ocx>0) then 'OCX'
      when exists(select 1 from public.ordini_righe where ordine_id=p_ordine_id and not riga_descrittiva and quantita_oci>0) then 'OCI'
      else null end;
    with goods as (
      select coalesce(aliquota_iva,0) rate,prezzo_netto,
        case when v_kind is null then quantita
          when upper(codice_articolo) like 'IMP%' then case when v_kind='OCM' then quantita else 0 end
          when o.tipo_ordine='prenotazione' then case when v_kind='OCI' then quantita else 0 end
          when v_kind='OCM' then quantita_ocm when v_kind='OCX' then quantita_ocx else quantita_oci end qty
      from public.ordini_righe where ordine_id=p_ordine_id and not riga_descrittiva
    ), groups as (select rate,sum(greatest(0,round(prezzo_netto*qty,2))) basis from goods where qty>0 group by rate)
    select coalesce(jsonb_agg(jsonb_build_object('rate',rate,'basis',basis) order by rate),'[]'::jsonb),count(*),coalesce(sum(basis),0)
      into v_tax_groups,v_groups,v_basis from groups;
    for g in select * from jsonb_to_recordset(v_tax_groups) as x(rate numeric,basis numeric)
    loop
      v_index := v_index + 1;
      v_share := case when v_index=v_groups then v_fee-v_allocated
        when v_basis>0 then round(v_fee*g.basis/v_basis,2) else round(v_fee/v_groups,2) end;
      v_allocated := v_allocated+v_share;
      v_vat := v_vat+round(v_share*g.rate/100,2);
      v_split := v_split || jsonb_build_array(jsonb_build_object('aliquota_iva',g.rate,'imponibile_riga',v_share,'iva_riga',round(v_share*g.rate/100,2)));
    end loop;
    insert into public.ordini_righe(ordine_id,codice_articolo,descrizione,riga_spedizione,riga_descrittiva,quantita,
      prezzo_listino,prezzo_netto,imponibile_riga,iva_riga,totale_riga,aliquota_iva,origine_prezzo,dettaglio_calcolo)
    values(p_ordine_id,null,'Spese di spedizione',true,true,1,v_fee,v_fee,v_fee,v_vat,v_fee+v_vat,
      case when v_groups=1 then (v_split->0->>'aliquota_iva')::numeric else 0 end,'configurazione-spedizione',
      jsonb_build_object('importo_minimo_porto_franco',c.importo_minimo_porto_franco,'addebito_spedizione',v_fee,'netto_merce',v_net,'documento_spedizione',v_kind,'ripartizione_iva',v_split));
  end if;
  update public.ordini_testate set
    importo_minimo_porto_franco=coalesce(c.importo_minimo_porto_franco,0),
    addebito_spedizione=coalesce(c.addebito_spedizione,0),
    totale_imponibile=t.net,totale_iva=t.vat,totale_documento=t.net+t.vat,totale=t.net+t.vat
  from (select coalesce(sum(coalesce(imponibile_riga,round(prezzo_netto*quantita,2))),0) net,
    coalesce(sum(coalesce(iva_riga,0)),0) vat from public.ordini_righe where ordine_id=p_ordine_id) t
  where id=p_ordine_id;
end;
$$;
revoke all on function public.applica_spedizione_ordine(uuid) from public,anon,authenticated;
grant execute on function public.applica_spedizione_ordine(uuid) to service_role;

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


-- Preserve the installed confirmation behavior and exclude non-stock charges.
create or replace function public.conferma_ordine_workspace(p_ordine_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r record;
begin
  perform 1 from public.ordini_testate where id=p_ordine_id and stato='bozza' for update;
  if not found then raise exception 'Ordine non trovato o già confermato'; end if;
  -- Keep caller visibility/ownership enforcement in the existing database RLS
  -- and customer boundary triggers when confirming a Private draft.
  perform public.applica_spedizione_ordine(p_ordine_id);
  update public.ordini_testate set stato='aperto',confermato_at=now(),
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

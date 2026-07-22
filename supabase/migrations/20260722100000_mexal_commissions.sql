-- Mexal commission categories are identifiers, never a mathematical formula.
alter table if exists public.ordini_prodotti_cache add column if not exists categoria_provvigionale_mexal integer;
alter table if exists public.ordini_clienti_cache add column if not exists categoria_provvigionale_mexal integer;
alter table if exists public.prodotti add column if not exists categoria_provvigionale_mexal integer;
alter table if exists public.clienti add column if not exists categoria_provvigionale_mexal integer;
alter table if exists public.ordini_righe
  add column if not exists provvigione_regola_id uuid,
  add column if not exists provvigione_dettaglio_calcolo jsonb,
  add column if not exists provvigione_calcolata_il timestamptz;

create table if not exists public.mexal_regole_provvigioni (
  id uuid primary key default gen_random_uuid(), categoria_cliente integer not null,
  categoria_prodotto integer not null, codice_agente_mexal text null,
  percentuale numeric(7,4) not null check (percentuale between 0 and 100),
  attiva boolean not null default true, valida_dal date null, valida_al date null,
  origine text not null default 'configurazione_workspace', dati_mexal jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(), aggiornato_il timestamptz not null default now(),
  check (valida_al is null or valida_dal is null or valida_al >= valida_dal)
);
create unique index if not exists mexal_regole_provvigioni_attive_uniche
  on public.mexal_regole_provvigioni (categoria_cliente, categoria_prodotto, coalesce(codice_agente_mexal, '')) where attiva;
create index if not exists mexal_regole_provvigioni_lookup on public.mexal_regole_provvigioni (categoria_cliente, categoria_prodotto, codice_agente_mexal) where attiva;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ordini_righe_provvigione_regola_fk'
      and conrelid = 'public.ordini_righe'::regclass
  ) then
    alter table public.ordini_righe add constraint ordini_righe_provvigione_regola_fk
      foreign key (provvigione_regola_id) references public.mexal_regole_provvigioni(id) on delete set null;
  end if;
end $$;

-- Regola estratta dal documento Mexal reale verificato: cliente categoria 2,
-- prodotto categoria 3, percentuale 7,5. Non deriva da alcuna formula ipotetica.
insert into public.mexal_regole_provvigioni (categoria_cliente, categoria_prodotto, percentuale, origine, dati_mexal)
select 2, 3, 7.5, 'documento_mexal_verificato', '{"evidenza":"categoria cliente 2 + categoria prodotto 3 = 7,5%"}'::jsonb
where not exists (select 1 from public.mexal_regole_provvigioni where categoria_cliente = 2 and categoria_prodotto = 3 and codice_agente_mexal is null and attiva);

-- This is based verbatim on the latest prior definition
-- (20260720230000_order_operations_atomic.sql); only the four commission
-- snapshot columns are appended to its replacement-row insert.
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
    insert into public.ordini_righe (ordine_id,codice_articolo,descrizione,quantita,quantita_ocm,quantita_ocx,quantita_oci,prezzo_listino,sconto_percentuale,sconto_commerciale,sconto_pagamento,origine_prezzo,origine_sconto,regola_prezzo_id,regola_sconto_id,regola_pagamento_id,dettaglio_calcolo,prezzo_netto,totale_riga,provvigione_percentuale,provvigione_regola_id,provvigione_dettaglio_calcolo,provvigione_calcolata_il)
    values (p_ordine_id,r.codice_articolo,r.descrizione,r.quantita,0,0,0,r.prezzo_listino,r.sconto_percentuale,r.sconto_commerciale,r.sconto_pagamento,r.origine_prezzo,r.origine_sconto,r.regola_prezzo_id,r.regola_sconto_id,r.regola_pagamento_id,coalesce(r.dettaglio_calcolo,'{}'::jsonb),r.prezzo_netto,r.totale_riga,r.provvigione_percentuale,r.provvigione_regola_id,r.provvigione_dettaglio_calcolo,r.provvigione_calcolata_il);
  end loop;
end $$;

create or replace function public.salva_provvigioni_ordine(p_ordine_id uuid, p_aggiornamenti jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if jsonb_typeof(p_aggiornamenti) <> 'array' or jsonb_array_length(p_aggiornamenti) = 0 then
    raise exception 'Aggiornamenti provvigionali non validi.' using errcode = '22023';
  end if;
  perform 1 from public.ordini_testate where id = p_ordine_id for update;
  if not found then raise exception 'Ordine non trovato' using errcode = 'P0002'; end if;
  if exists (select 1 from jsonb_to_recordset(p_aggiornamenti) as u(id uuid, provvigione_percentuale numeric, provvigione_regola_id uuid, provvigione_dettaglio_calcolo jsonb, provvigione_calcolata_il timestamptz) group by id having count(*) > 1) then
    raise exception 'Aggiornamenti provvigionali duplicati.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_aggiornamenti) as u(id uuid, provvigione_percentuale numeric, provvigione_regola_id uuid, provvigione_dettaglio_calcolo jsonb, provvigione_calcolata_il timestamptz) where provvigione_percentuale is null or provvigione_percentuale < 0 or provvigione_percentuale > 100) then
    raise exception 'Percentuale provvigionale non valida.' using errcode = '22023';
  end if;
  select count(*) into v_count from public.ordini_righe r join jsonb_to_recordset(p_aggiornamenti) as u(id uuid, provvigione_percentuale numeric, provvigione_regola_id uuid, provvigione_dettaglio_calcolo jsonb, provvigione_calcolata_il timestamptz) on u.id = r.id where r.ordine_id = p_ordine_id;
  if v_count <> jsonb_array_length(p_aggiornamenti) then raise exception 'Una o più righe non appartengono all’ordine.' using errcode = 'P0001'; end if;
  update public.ordini_righe r set provvigione_percentuale=u.provvigione_percentuale, provvigione_regola_id=u.provvigione_regola_id, provvigione_dettaglio_calcolo=u.provvigione_dettaglio_calcolo, provvigione_calcolata_il=u.provvigione_calcolata_il from jsonb_to_recordset(p_aggiornamenti) as u(id uuid, provvigione_percentuale numeric, provvigione_regola_id uuid, provvigione_dettaglio_calcolo jsonb, provvigione_calcolata_il timestamptz) where r.id=u.id and r.ordine_id=p_ordine_id;
end $$;
revoke all on function public.salva_provvigioni_ordine(uuid,jsonb) from public;
revoke all on function public.salva_provvigioni_ordine(uuid,jsonb) from anon;
revoke all on function public.salva_provvigioni_ordine(uuid,jsonb) from authenticated;
grant execute on function public.salva_provvigioni_ordine(uuid,jsonb) to service_role;

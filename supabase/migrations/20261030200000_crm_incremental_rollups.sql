-- Precompute CRM-only invoice exclusions and line totals at import/update time.
-- The canonical Mexal documents and operational invoice/order links remain untouched.
create table public.crm_invoice_rollups (
 fattura_id uuid primary key references public.mexal_fatture_vendita(id) on delete cascade,
 excluded_net numeric not null default 0, excluded_vat numeric not null default 0,
 excluded_count bigint not null default 0, other_product_count bigint not null default 0,
 included_line_net numeric not null default 0, included_line_count bigint not null default 0
);
create table public.crm_order_rollups (
 ordine_id uuid primary key references public.ordini_testate(id) on delete cascade,
 excluded_net numeric not null default 0, excluded_vat numeric not null default 0,
 ocm_amount numeric not null default 0, ocx_amount numeric not null default 0, oci_amount numeric not null default 0,
 excluded_count bigint not null default 0, other_product_count bigint not null default 0
);
alter table public.crm_invoice_rollups enable row level security;
alter table public.crm_order_rollups enable row level security;
create policy crm_invoice_rollups_source_visibility on public.crm_invoice_rollups for select to authenticated
 using(exists(select 1 from public.mexal_fatture_vendita f where f.id=fattura_id));
create policy crm_order_rollups_source_visibility on public.crm_order_rollups for select to authenticated
 using(exists(select 1 from public.ordini_testate o where o.id=ordine_id));
revoke all on public.crm_invoice_rollups,public.crm_order_rollups from public,anon,authenticated;
grant select on public.crm_invoice_rollups,public.crm_order_rollups to authenticated,service_role;

create function public.crm_refresh_invoice_rollup(p_id uuid) returns void
language plpgsql security definer set search_path=public as $body$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,71310));
 insert into public.crm_invoice_rollups
 select f.id,
 coalesce(sum(case when upper(btrim(f.sigla))='NC' then -abs(coalesce(l.valore_netto,l.valore_lordo,l.quantita*l.prezzo_unitario,0)) else coalesce(l.valore_netto,l.valore_lordo,l.quantita*l.prezzo_unitario,0) end)
 filter(where upper(btrim(l.codice_articolo))='ARTGEN'),0),
 coalesce(sum((case when upper(btrim(f.sigla))='NC' then -abs(coalesce(l.valore_netto,l.valore_lordo,l.quantita*l.prezzo_unitario,0)) else coalesce(l.valore_netto,l.valore_lordo,l.quantita*l.prezzo_unitario,0) end)
 *coalesce(l.aliquota_iva/100,f.totale_iva/nullif(f.totale_imponibile,0),0)) filter(where upper(btrim(l.codice_articolo))='ARTGEN'),0),
 count(l.id) filter(where upper(btrim(l.codice_articolo))='ARTGEN'),
 count(l.id) filter(where nullif(btrim(l.codice_articolo),'') is not null and upper(btrim(l.codice_articolo))<>'ARTGEN'),
 coalesce(sum(coalesce(l.valore_netto,l.valore_lordo,l.quantita*l.prezzo_unitario,0)) filter(where upper(btrim(coalesce(l.codice_articolo,'')))<>'ARTGEN'),0),
 count(l.id) filter(where upper(btrim(coalesce(l.codice_articolo,'')))<>'ARTGEN')
 from public.mexal_fatture_vendita f left join public.mexal_fatture_vendita_righe l on l.fattura_id=f.id where f.id=p_id group by f.id
 on conflict(fattura_id) do update set excluded_net=excluded.excluded_net,excluded_vat=excluded.excluded_vat,
 excluded_count=excluded.excluded_count,other_product_count=excluded.other_product_count,
 included_line_net=excluded.included_line_net,included_line_count=excluded.included_line_count;
end;$body$;
create function public.crm_refresh_order_rollup(p_id uuid) returns void
language plpgsql security definer set search_path=public as $body$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,71311));
 insert into public.crm_order_rollups
 select o.id,
 coalesce(sum(coalesce(r.imponibile_riga,r.quantita*r.prezzo_netto,r.totale_riga,0)) filter(where upper(btrim(r.codice_articolo))='ARTGEN'),0),
 coalesce(sum(coalesce(r.iva_riga,coalesce(r.imponibile_riga,r.quantita*r.prezzo_netto,r.totale_riga,0)*coalesce(r.aliquota_iva,0)/100)) filter(where upper(btrim(r.codice_articolo))='ARTGEN'),0),
 coalesce(sum(r.quantita_ocm*coalesce(r.prezzo_netto,r.imponibile_riga/nullif(r.quantita,0),0)) filter(where upper(btrim(r.codice_articolo))='ARTGEN'),0),
 coalesce(sum(r.quantita_ocx*coalesce(r.prezzo_netto,r.imponibile_riga/nullif(r.quantita,0),0)) filter(where upper(btrim(r.codice_articolo))='ARTGEN'),0),
 coalesce(sum(r.quantita_oci*coalesce(r.prezzo_netto,r.imponibile_riga/nullif(r.quantita,0),0)) filter(where upper(btrim(r.codice_articolo))='ARTGEN'),0),
 count(r.id) filter(where upper(btrim(r.codice_articolo))='ARTGEN'),
 count(r.id) filter(where nullif(btrim(r.codice_articolo),'') is not null and upper(btrim(r.codice_articolo))<>'ARTGEN')
 from public.ordini_testate o left join public.ordini_righe r on r.ordine_id=o.id
 and not coalesce(r.riga_descrittiva,false) and coalesce(r.mexal_attiva,true)
 where o.id=p_id group by o.id
 on conflict(ordine_id) do update set excluded_net=excluded.excluded_net,excluded_vat=excluded.excluded_vat,
 ocm_amount=excluded.ocm_amount,ocx_amount=excluded.ocx_amount,oci_amount=excluded.oci_amount,
 excluded_count=excluded.excluded_count,other_product_count=excluded.other_product_count;
end;$body$;

create function public.crm_refresh_header_rollup() returns trigger
language plpgsql security definer set search_path=public as $body$
begin
 if TG_TABLE_NAME='mexal_fatture_vendita' then perform public.crm_refresh_invoice_rollup(new.id);
 else perform public.crm_refresh_order_rollup(new.id); end if;
 return null;
end;$body$;
create trigger crm_invoice_rollup_header after insert or update on public.mexal_fatture_vendita
 for each row execute function public.crm_refresh_header_rollup();
create trigger crm_order_rollup_header after insert or update on public.ordini_testate
 for each row execute function public.crm_refresh_header_rollup();

create function public.crm_invoice_rollup_insert() returns trigger language plpgsql security definer set search_path=public as $body$
declare affected record;
begin
 for affected in select distinct fattura_id id from new_rows order by id loop
  perform public.crm_refresh_invoice_rollup(affected.id);
 end loop; return null;
end;$body$;
create trigger crm_invoice_rollup_insert after insert on public.mexal_fatture_vendita_righe
 referencing new table as new_rows
 for each statement execute function public.crm_invoice_rollup_insert();

create function public.crm_invoice_rollup_update() returns trigger language plpgsql security definer set search_path=public as $body$
declare affected record;
begin
 for affected in select fattura_id id from new_rows union select fattura_id id from old_rows order by id loop
  perform public.crm_refresh_invoice_rollup(affected.id);
 end loop; return null;
end;$body$;
create trigger crm_invoice_rollup_update after update on public.mexal_fatture_vendita_righe
 referencing old table as old_rows new table as new_rows
 for each statement execute function public.crm_invoice_rollup_update();

create function public.crm_invoice_rollup_delete() returns trigger language plpgsql security definer set search_path=public as $body$
declare affected record;
begin
 for affected in select distinct fattura_id id from old_rows order by id loop
  perform public.crm_refresh_invoice_rollup(affected.id);
 end loop; return null;
end;$body$;
create trigger crm_invoice_rollup_delete after delete on public.mexal_fatture_vendita_righe
 referencing old table as old_rows
 for each statement execute function public.crm_invoice_rollup_delete();

create function public.crm_order_rollup_insert() returns trigger language plpgsql security definer set search_path=public as $body$
declare affected record;
begin
 for affected in select distinct ordine_id id from new_rows order by id loop
  perform public.crm_refresh_order_rollup(affected.id);
 end loop; return null;
end;$body$;
create trigger crm_order_rollup_insert after insert on public.ordini_righe
 referencing new table as new_rows
 for each statement execute function public.crm_order_rollup_insert();

create function public.crm_order_rollup_update() returns trigger language plpgsql security definer set search_path=public as $body$
declare affected record;
begin
 for affected in select ordine_id id from new_rows union select ordine_id id from old_rows order by id loop
  perform public.crm_refresh_order_rollup(affected.id);
 end loop; return null;
end;$body$;
create trigger crm_order_rollup_update after update on public.ordini_righe
 referencing old table as old_rows new table as new_rows
 for each statement execute function public.crm_order_rollup_update();

create function public.crm_order_rollup_delete() returns trigger language plpgsql security definer set search_path=public as $body$
declare affected record;
begin
 for affected in select distinct ordine_id id from old_rows order by id loop
  perform public.crm_refresh_order_rollup(affected.id);
 end loop; return null;
end;$body$;
create trigger crm_order_rollup_delete after delete on public.ordini_righe
 referencing old table as old_rows
 for each statement execute function public.crm_order_rollup_delete();

-- Populate once; subsequent imports update only affected documents in the same transaction.
do $backfill$ declare doc record; begin
 for doc in select id from public.mexal_fatture_vendita order by id loop perform public.crm_refresh_invoice_rollup(doc.id); end loop;
 for doc in select id from public.ordini_testate order by id loop perform public.crm_refresh_order_rollup(doc.id); end loop;
end;$backfill$;

create or replace view public.crm_invoice_exclusions with(security_invoker=true) as
 select fattura_id,excluded_net net_amount,excluded_vat vat_amount from public.crm_invoice_rollups where excluded_count>0;
create or replace view public.crm_order_exclusions with(security_invoker=true) as
 select ordine_id,excluded_net net_amount,excluded_vat vat_amount,ocm_amount,ocx_amount,oci_amount from public.crm_order_rollups where excluded_count>0;

create or replace view public.crm_sales_invoices with (security_invoker = true) as
select f.id,
 f.sigla,
 f.cod_modulo,
 f.serie,
 f.numero,
 f.data_documento,
 f.codice_cliente,
 f.ragione_sociale_cliente,
 f.codice_agente_mexal,
 f.agente_nome,
 f.id_pagamento,
 f.nota,
 (f.totale_imponibile - coalesce(x.net_amount,0))::numeric(16,4) as totale_imponibile,
 (f.totale_iva - coalesce(x.vat_amount,0))::numeric(16,4) as totale_iva,
 (f.totale_documento - coalesce(x.net_amount,0) - coalesce(x.vat_amount,0))::numeric(16,4) as totale_documento,
 f.dati_mexal,
 f.sincronizzato_il,
 f.creato_il,
 f.aggiornato_il,
 f.causale_magazzino_codice,
 f.causale_magazzino_descrizione
from public.mexal_fatture_vendita f left join public.crm_invoice_exclusions x on x.fattura_id=f.id
where not (upper(btrim(coalesce(f.sigla,'')))='FT' and coalesce(f.serie,0)=4)
and (x.fattura_id is null or exists(select 1 from public.crm_invoice_rollups keep where keep.fattura_id=f.id and keep.other_product_count>0));

create or replace view public.crm_sales_orders with (security_invoker = true) as
select o.id,
 o.creato_da,
 o.codice_agente_mexal,
 o.codice_cliente,
 o.ragione_sociale_cliente,
 o.data_ordine,
 o.mese_ordine,
 o.stato,
 o.numero_ordine,
 o.numero_ocm,
 o.numero_ocx,
 (o.totale - coalesce(x.net_amount,0) - coalesce(x.vat_amount,0)) as totale,
 o.note,
 o.errore_mexal,
 o.risposta_mexal,
 o.created_at,
 o.updated_at,
 o.codice_pagamento,
 o.descrizione_pagamento,
 o.codice_listino,
 o.indirizzo_spedizione,
 o.note_mexal,
 o.commenti,
 o.sincronizzato_mexal,
 o.sincronizzato_mexal_il,
 o.confermato_at,
 o.stato_sincronizzazione,
 o.errore_sincronizzazione,
 o.ultimo_tentativo_sync,
 o.numero_oci,
 o.arresto_sync_richiesto,
 o.arresto_sync_richiesto_il,
 o.arresto_sync_richiesto_da,
 o.sincronizzazione_iniziata_il,
 o.sincronizzazione_heartbeat_il,
 o.sync_token,
 (o.totale_imponibile - coalesce(x.net_amount,0))::numeric(14,2) as totale_imponibile,
 (o.totale_iva - coalesce(x.vat_amount,0))::numeric(14,2) as totale_iva,
 (o.totale_documento - coalesce(x.net_amount,0) - coalesce(x.vat_amount,0))::numeric(14,2) as totale_documento,
 o.totali_mexal_verificati,
 o.differenza_iva_mexal,
 o.differenza_totale_mexal,
 o.totali_mexal_verificati_at,
 o.partita_iva,
 o.numero_progressivo,
 o.anno_progressivo,
 o.numero_ordine_visualizzato,
 o.codice_pagamento_mexal,
 o.descrizione_pagamento_mexal,
 o.trasporto_mexal,
 o.destinazione_mexal,
 o.modulo_ordini,
 o.agente_nome,
 o.tipo_ordine,
 o.origine,
 o.mexal_sigla,
 o.mexal_cod_modulo,
 o.mexal_serie,
 o.mexal_numero,
 o.mexal_anno,
 o.mexal_chiave,
 o.mexal_cod_conto,
 o.mexal_sincronizzato_il,
 o.cliente_mexal_risolto,
 o.data_consegna,
 o.numero_oct,
 o.mexal_eliminato_il,
 o.importo_minimo_porto_franco,
 o.addebito_spedizione,
 o.versione_conferma,
 o.mexal_mes_eliminato_il,
 o.mexal_mes_eliminazione_errore
from public.ordini_testate o left join public.crm_order_exclusions x on x.ordine_id=o.id
where x.ordine_id is null or exists(select 1 from public.crm_order_rollups keep where keep.ordine_id=o.id and keep.other_product_count>0);

-- A compact, RLS-preserving net line total for each invoice; used before customer grouping.
create view public.crm_invoice_line_totals with(security_invoker=true) as
 select f.id,f.codice_cliente,f.data_documento,r.included_line_net net_amount
 from public.crm_sales_invoices f join public.crm_invoice_rollups r on r.fattura_id=f.id;
grant select on public.crm_invoice_line_totals to authenticated,service_role;
revoke all on public.crm_invoice_line_totals from public,anon;
revoke all on function public.crm_refresh_invoice_rollup(uuid) from public,anon,authenticated;
revoke all on function public.crm_refresh_order_rollup(uuid) from public,anon,authenticated;
revoke all on function public.crm_refresh_header_rollup() from public,anon,authenticated;
revoke all on function public.crm_invoice_rollup_insert() from public,anon,authenticated;
revoke all on function public.crm_invoice_rollup_update() from public,anon,authenticated;
revoke all on function public.crm_invoice_rollup_delete() from public,anon,authenticated;
revoke all on function public.crm_order_rollup_insert() from public,anon,authenticated;
revoke all on function public.crm_order_rollup_update() from public,anon,authenticated;
revoke all on function public.crm_order_rollup_delete() from public,anon,authenticated;

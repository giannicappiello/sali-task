-- Fase 1C.0: registra oct_orders spento e blocca l'outbound nel CAS eseguito
-- prima di ogni chiamata Mexal. I CHECK richiedono un breve lock controllato.
-- Gli indici 1C.0 restano non-CONCURRENTLY: il runner non garantisce l'esecuzione
-- fuori transazione; applicare la migrazione in finestra controllata.
alter table public.mexal_sync_schedules drop constraint if exists mexal_sync_schedules_sync_type_check;
alter table public.mexal_sync_schedules add constraint mexal_sync_schedules_sync_type_check
  check (sync_type in ('clients','agents','products','product_categories','commercial_conditions','document_series','stocks','orders','payments','list_price_commissions','sales_invoices','oct_orders'));

alter table public.mexal_sync_runs drop constraint if exists mexal_sync_runs_sync_type_check;
alter table public.mexal_sync_runs add constraint mexal_sync_runs_sync_type_check
  check (sync_type in ('products','product_categories','clients','stocks','orders','commercial_conditions','document_series','agents','payments','list_price_commissions','sales_invoices','oct_orders'));

alter table public.mexal_sync_jobs drop constraint if exists mexal_sync_jobs_sync_type_check;
alter table public.mexal_sync_jobs add constraint mexal_sync_jobs_sync_type_check
  check (sync_type in ('clients','agents','products','product_categories','commercial_conditions','document_series','stocks','list_price_commissions','orders','payments','sales_invoices','oct_orders'));

insert into public.mexal_sync_schedules(sync_type, enabled, schedule_mode, batch_size, execution_order)
values ('oct_orders', false, 'daily_vercel_hobby', 100, 90)
on conflict(sync_type) do update set enabled = false;

insert into public.permessi(codice, descrizione, modulo)
values ('integrations.sync.oct_orders', 'Importa ordini cliente OCT', 'integrazioni')
on conflict (codice) do update set descrizione = excluded.descrizione, modulo = excluded.modulo;

alter table public.ordini_testate drop constraint if exists ordini_testate_stato_sincronizzazione_check;
alter table public.ordini_testate add constraint ordini_testate_stato_sincronizzazione_check
  check (stato_sincronizzazione in (
    'non_inviato','non_avviato','in_corso','arresto_richiesto','arrestato',
    'completato','errore','annullato','importato_mexal'
  ));

-- Vincolo feature-specific: un rollback del codice applicativo non può portare
-- un OCT inbound nello stato/token usato dall'outbound. La RPC storica fallisce
-- atomicamente prima che submit-order costruisca il client o chiami Mexal.
alter table public.ordini_testate add constraint phase1c0_mexal_oct_outbound_guard_check
  check (coalesce(origine, 'workspace') <> 'mexal_oct' or (
    stato_sincronizzazione = 'importato_mexal' and sync_token is null
  ));

-- Le pagine Ordini e Nuovo ordine non devono mai avviare sincronizzazioni.
-- Manteniamo la configurazione storica, ma disattiviamo ogni esecuzione automatica esistente.
update public.mexal_event_automations set enabled = false where coalesce(enabled, true) = true;
update public.mexal_sync_schedules set enabled = false where enabled = true;

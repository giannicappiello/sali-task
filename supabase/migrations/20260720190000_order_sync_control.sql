-- Cooperative order-sync control.  The compare-and-set function is deliberately
-- used by the server endpoint so two browser requests cannot start one order.
alter table public.ordini_testate
  add column if not exists arresto_sync_richiesto boolean not null default false,
  add column if not exists arresto_sync_richiesto_il timestamptz,
  add column if not exists arresto_sync_richiesto_da uuid,
  add column if not exists sincronizzazione_iniziata_il timestamptz,
  add column if not exists sincronizzazione_heartbeat_il timestamptz,
  add column if not exists sync_token uuid;

alter table public.ordini_testate drop constraint if exists ordini_testate_stato_sincronizzazione_check;
alter table public.ordini_testate add constraint ordini_testate_stato_sincronizzazione_check
  check (stato_sincronizzazione in ('non_inviato','non_avviato','in_corso','arresto_richiesto','arrestato','completato','errore','annullato'));

create or replace function public.avvia_sync_ordine(p_ordine_id uuid, p_sync_token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update ordini_testate set stato_sincronizzazione = 'in_corso', sync_token = p_sync_token,
    arresto_sync_richiesto = false, arresto_sync_richiesto_il = null, arresto_sync_richiesto_da = null,
    sincronizzazione_iniziata_il = now(), sincronizzazione_heartbeat_il = now(),
    ultimo_tentativo_sync = now(), errore_sincronizzazione = null
  where id = p_ordine_id
    and stato_sincronizzazione in ('non_inviato','non_avviato','errore','annullato','arrestato');
  return found;
end $$;

create or replace function public.recupera_sync_ordine_scaduta(p_ordine_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update ordini_testate set stato_sincronizzazione = case when arresto_sync_richiesto then 'arrestato' else 'errore' end,
    errore_sincronizzazione = case when arresto_sync_richiesto then 'Arresto sincronizzazione completato dopo heartbeat scaduto.' else 'Sincronizzazione abbandonata: heartbeat scaduto.' end,
    sync_token = null
  where id = p_ordine_id and stato_sincronizzazione in ('in_corso','arresto_richiesto')
    and coalesce(sincronizzazione_heartbeat_il, sincronizzazione_iniziata_il, ultimo_tentativo_sync) < now() - interval '5 minutes';
  return found;
end $$;

revoke all on function public.avvia_sync_ordine(uuid, uuid) from public;
revoke all on function public.recupera_sync_ordine_scaduta(uuid) from public;
revoke all on function public.avvia_sync_ordine(uuid, uuid) from anon;
revoke all on function public.avvia_sync_ordine(uuid, uuid) from authenticated;
revoke all on function public.recupera_sync_ordine_scaduta(uuid) from anon;
revoke all on function public.recupera_sync_ordine_scaduta(uuid) from authenticated;
grant execute on function public.avvia_sync_ordine(uuid, uuid) to service_role;
grant execute on function public.recupera_sync_ordine_scaduta(uuid) to service_role;

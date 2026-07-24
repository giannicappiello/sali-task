-- Documenti ordine Mexal figli, sincronizzazione e manutenzione Workspace.
-- Migrazione ripetibile: estende la struttura esistente senza perdere dati.
alter table if exists public.ordini_documenti_mexal
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists modulo text,
  add column if not exists anno integer,
  add column if not exists stato_operativo text not null default 'APERTO',
  add column if not exists presente_in_mexal boolean not null default true,
  add column if not exists evaso_il timestamptz,
  add column if not exists ultimo_sync_mexal timestamptz;

update public.ordini_documenti_mexal d set modulo = case when lower(coalesce(t.modulo_ordini, 'prof')) = 'ph' then 'ORDINIPH' else 'ORDINIPR' end
from public.ordini_testate t where t.id = d.ordine_id and d.modulo is null;
update public.ordini_documenti_mexal set anno = extract(year from coalesce(creato_il, aggiornato_il, now()))::integer where anno is null;
alter table if exists public.ordini_documenti_mexal alter column modulo set default 'ORDINIPR';
alter table if exists public.ordini_documenti_mexal drop constraint if exists ordini_documenti_mexal_modulo_check;
alter table if exists public.ordini_documenti_mexal add constraint ordini_documenti_mexal_modulo_check check (modulo in ('ORDINIPH', 'ORDINIPR'));
alter table if exists public.ordini_documenti_mexal drop constraint if exists ordini_documenti_mexal_stato_operativo_check;
alter table if exists public.ordini_documenti_mexal add constraint ordini_documenti_mexal_stato_operativo_check check (stato_operativo in ('APERTO', 'EVASO', 'ANNULLATO', 'ERRORE'));
create unique index if not exists ordini_documenti_mexal_id_uidx on public.ordini_documenti_mexal(id);
create unique index if not exists ordini_documenti_mexal_riferimento_uidx on public.ordini_documenti_mexal(sigla, serie, numero, anno) where numero is not null;
create index if not exists ordini_documenti_mexal_attivi_idx on public.ordini_documenti_mexal(modulo, tipo_documento, stato_operativo) where presente_in_mexal;
create index if not exists ordini_documenti_mexal_evaso_il_idx on public.ordini_documenti_mexal(evaso_il) where stato_operativo = 'EVASO';

create table if not exists public.ordini_documenti_mexal_righe (
  id uuid primary key default gen_random_uuid(),
  documento_mexal_id uuid not null references public.ordini_documenti_mexal(id) on delete cascade,
  ordine_riga_id uuid references public.ordini_righe(id) on delete set null,
  posizione integer not null,
  codice_articolo text, descrizione text, quantita numeric not null default 0, prezzo numeric, sconto numeric,
  dati_mexal jsonb not null default '{}'::jsonb,
  creato_il timestamptz not null default now(), aggiornato_il timestamptz not null default now(),
  unique(documento_mexal_id, posizione)
);
create index if not exists ordini_documenti_mexal_righe_origine_idx on public.ordini_documenti_mexal_righe(ordine_riga_id);
alter table public.ordini_documenti_mexal_righe enable row level security;

create table if not exists public.mexal_ordini_manutenzione (
  id integer primary key default 1 check (id = 1),
  giorni_conservazione_evasi integer not null default 365 check (giorni_conservazione_evasi between 1 and 3650),
  pulizia_automatica boolean not null default false,
  ultima_pulizia_il timestamptz, ultimo_riepilogo jsonb not null default '{}'::jsonb,
  aggiornato_il timestamptz not null default now()
);
insert into public.mexal_ordini_manutenzione(id) values (1) on conflict (id) do nothing;
alter table public.mexal_ordini_manutenzione enable row level security;
drop policy if exists "admins read mexal order maintenance" on public.mexal_ordini_manutenzione;
create policy "admins read mexal order maintenance" on public.mexal_ordini_manutenzione for select to authenticated using (
  exists (select 1 from public.utenti u left join public.ruoli r on r.id=u.ruolo_id where u.auth_user_id=auth.uid() and u.attivo is not false and (coalesce(r.livello,0)>=80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione')))
);
drop policy if exists "admins manage mexal order maintenance" on public.mexal_ordini_manutenzione;
create policy "admins manage mexal order maintenance" on public.mexal_ordini_manutenzione for all to authenticated using (
  exists (select 1 from public.utenti u left join public.ruoli r on r.id=u.ruolo_id where u.auth_user_id=auth.uid() and u.attivo is not false and (coalesce(r.livello,0)>=80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione')))
) with check (
  exists (select 1 from public.utenti u left join public.ruoli r on r.id=u.ruolo_id where u.auth_user_id=auth.uid() and u.attivo is not false and (coalesce(r.livello,0)>=80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione')))
);

alter table if exists public.mexal_sync_schedules drop constraint if exists mexal_sync_schedules_sync_type_check;
alter table if exists public.mexal_sync_schedules add constraint mexal_sync_schedules_sync_type_check check (sync_type in ('clients','agents','products','commercial_conditions','document_series','stocks','orders','payments','list_price_commissions'));
insert into public.mexal_sync_schedules(sync_type, enabled, schedule_mode, batch_size, execution_order)
select 'orders', false, 'daily_vercel_hobby', 100, 80 where not exists (select 1 from public.mexal_sync_schedules where sync_type='orders');

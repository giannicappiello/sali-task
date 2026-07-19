-- Configurable Mexal automations. All rules start disabled; the dispatcher is service-role only.
create table if not exists public.mexal_automation_rules (
 id uuid primary key default gen_random_uuid(), name text not null, automation_type text not null,
 trigger_type text not null, entity_type text, enabled boolean not null default false,
 frequency_type text, cron_expression text, timezone text not null default 'Europe/Rome',
 action_chain jsonb not null default '[]'::jsonb, configuration jsonb not null default '{}'::jsonb,
 last_run_at timestamptz, next_run_at timestamptz, created_by uuid, updated_by uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint mexal_automation_rules_type_check check (automation_type in ('scheduled','event')),
 constraint mexal_automation_rules_frequency_check check (frequency_type is null or frequency_type in ('manual','every_15_minutes','every_30_minutes','hourly','every_2_hours','every_6_hours','every_12_hours','daily','weekly','custom_daily'))
);
create table if not exists public.mexal_automation_runs (
 id uuid primary key default gen_random_uuid(), automation_rule_id uuid references public.mexal_automation_rules(id) on delete set null,
 trigger_type text not null, trigger_reference text, status text not null default 'queued', started_at timestamptz not null default now(), completed_at timestamptz,
 current_action text, processed_actions integer not null default 0, failed_actions integer not null default 0,
 result jsonb not null default '{}'::jsonb, error_message text, idempotency_key text, created_at timestamptz not null default now(),
 constraint mexal_automation_runs_status_check check (status in ('queued','running','completed','failed','stopped','skipped'))
);
create table if not exists public.mexal_automation_action_runs (
 id uuid primary key default gen_random_uuid(), automation_run_id uuid not null references public.mexal_automation_runs(id) on delete cascade,
 action_type text not null, action_order integer not null, status text not null, started_at timestamptz, completed_at timestamptz,
 result jsonb not null default '{}'::jsonb, error_message text, idempotency_key text, created_at timestamptz not null default now(),
 constraint mexal_automation_action_runs_status_check check (status in ('queued','running','completed','failed','stopped','skipped'))
);
create index if not exists mexal_automation_rules_enabled_next_idx on public.mexal_automation_rules(enabled,next_run_at);
create index if not exists mexal_automation_runs_status_idx on public.mexal_automation_runs(status);
create index if not exists mexal_automation_runs_rule_idx on public.mexal_automation_runs(automation_rule_id);
create index if not exists mexal_automation_runs_reference_idx on public.mexal_automation_runs(trigger_reference);
create unique index if not exists mexal_automation_runs_idempotency_key_idx on public.mexal_automation_runs(idempotency_key) where idempotency_key is not null;
create unique index if not exists mexal_automation_action_runs_idempotency_key_idx on public.mexal_automation_action_runs(idempotency_key) where idempotency_key is not null;
alter table public.mexal_automation_rules enable row level security;
alter table public.mexal_automation_runs enable row level security;
alter table public.mexal_automation_action_runs enable row level security;
drop policy if exists "mexal automation rules admin manage" on public.mexal_automation_rules;
create policy "mexal automation rules admin manage" on public.mexal_automation_rules for all to authenticated using (exists (select 1 from public.utenti u left join public.ruoli r on r.id=u.ruolo_id where u.auth_user_id=auth.uid() and u.attivo is not false and (coalesce(r.livello,0)>=80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione')))) with check (exists (select 1 from public.utenti u left join public.ruoli r on r.id=u.ruolo_id where u.auth_user_id=auth.uid() and u.attivo is not false and (coalesce(r.livello,0)>=80 or lower(coalesce(r.nome,'')) in ('admin','administrator','amministratore','super admin','direzione'))));
create policy "mexal automation runs authorized read" on public.mexal_automation_runs for select to authenticated using (exists (select 1 from public.utenti u where u.auth_user_id=auth.uid() and u.attivo is not false));
create policy "mexal automation action runs authorized read" on public.mexal_automation_action_runs for select to authenticated using (exists (select 1 from public.utenti u where u.auth_user_id=auth.uid() and u.attivo is not false));
alter table public.mexal_automation_rules add constraint mexal_automation_rules_action_chain_array_check check (jsonb_typeof(action_chain) = 'array');
alter table public.mexal_automation_rules add constraint mexal_automation_rules_configuration_object_check check (jsonb_typeof(configuration) = 'object');
create or replace function public.set_mexal_automation_rules_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists mexal_automation_rules_updated_at on public.mexal_automation_rules;
create trigger mexal_automation_rules_updated_at before update on public.mexal_automation_rules for each row execute function public.set_mexal_automation_rules_updated_at();

-- CRM PRIVATE / B2B: configurazione operativa, chiusure guidate e continuita del follow-up.
-- Migrazione esclusivamente additiva: nessun dato commerciale esistente viene riscritto.

create table if not exists public.crm_workflow_settings (
  crm_tipo text primary key check (crm_tipo in ('conto_terzi','b2b')),
  nuovi_clienti_giorni integer not null default 90 check (nuovi_clienti_giorni > 0),
  riordino_giorni_default integer not null default 90 check (riordino_giorni_default > 0),
  rischio_moltiplicatore numeric(6,2) not null default 1.50 check (rischio_moltiplicatore > 0),
  dormiente_moltiplicatore numeric(6,2) not null default 2.00 check (dormiente_moltiplicatore > 0),
  perso_moltiplicatore numeric(6,2) not null default 3.00 check (perso_moltiplicatore > 0),
  beauty_post_evento_giorni integer not null default 30 check (beauty_post_evento_giorni > 0),
  aggiornato_da uuid references public.utenti(id) on delete set null,
  aggiornato_il timestamptz not null default now()
);

insert into public.crm_workflow_settings (crm_tipo)
values ('conto_terzi'), ('b2b')
on conflict (crm_tipo) do nothing;

create table if not exists public.crm_loss_reasons (
  id uuid primary key default gen_random_uuid(),
  crm_tipo text not null check (crm_tipo in ('conto_terzi','b2b')),
  codice text not null,
  nome text not null,
  ordine integer not null default 0,
  attivo boolean not null default true,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  unique (crm_tipo, codice)
);

insert into public.crm_loss_reasons (crm_tipo, codice, nome, ordine)
select crm_tipo, codice, nome, ordine
from (values
  ('conto_terzi','prezzo','Prezzo',10),
  ('conto_terzi','tempistiche','Tempistiche',20),
  ('conto_terzi','specifiche','Specifiche tecniche',30),
  ('conto_terzi','concorrente','Scelta di un concorrente',40),
  ('conto_terzi','progetto_sospeso','Progetto sospeso',50),
  ('conto_terzi','altro','Altro',90),
  ('b2b','prezzo','Prezzo',10),
  ('b2b','assortimento','Assortimento',20),
  ('b2b','condizioni','Condizioni commerciali',30),
  ('b2b','concorrente','Scelta di un concorrente',40),
  ('b2b','nessun_riscontro','Nessun riscontro',50),
  ('b2b','altro','Altro',90)
) as seed(crm_tipo,codice,nome,ordine)
on conflict (crm_tipo,codice) do nothing;

alter table public.crm_opportunity_stages
  add column if not exists probabilita_default integer,
  add column if not exists soglia_aging_giorni integer;

alter table public.crm_opportunity_stages
  drop constraint if exists crm_opportunity_stages_probabilita_default_check;
alter table public.crm_opportunity_stages
  add constraint crm_opportunity_stages_probabilita_default_check
  check (probabilita_default is null or probabilita_default between 0 and 100);

update public.crm_opportunity_stages
set probabilita_default = case
  when vinta then 100 when finale then 0
  when codice in ('lead') then 10
  when codice in ('nuovo_contatto','primo_contatto') then 20
  when codice in ('qualificazione','valutazione') then 30
  when codice in ('brief','presentazione') then 40
  when codice = 'campionatura' then 50
  when codice = 'offerta' then 60
  when codice = 'negoziazione' then 75
  when codice in ('approvazione','attesa_ordine') then 85
  when codice in ('industrializzazione','cliente_attivo') then 90
  else coalesce(probabilita_default, 25)
end,
soglia_aging_giorni = coalesce(soglia_aging_giorni, case when finale then null else 30 end)
where crm_tipo in ('conto_terzi','b2b')
  and (probabilita_default is null or (not finale and soglia_aging_giorni is null));

alter table public.crm_opportunities
  add column if not exists aperta_il date,
  add column if not exists chiusa_il timestamptz,
  add column if not exists valore_finale numeric(14,2),
  add column if not exists concorrente text,
  add column if not exists motivo_perdita_id uuid references public.crm_loss_reasons(id) on delete set null,
  add column if not exists data_ricontatto date,
  add column if not exists ordine_collegato_id uuid references public.ordini_testate(id) on delete set null;

update public.crm_opportunities
set aperta_il = creato_il::date
where aperta_il is null;

alter table public.crm_opportunities
  alter column aperta_il set default current_date;

alter table public.crm_activities
  add column if not exists contact_id uuid references public.crm_contacts(id) on delete set null,
  add column if not exists project_id uuid references public.v4_progetti(id) on delete set null,
  add column if not exists esito text,
  add column if not exists prossima_azione text,
  add column if not exists priorita text not null default 'normale';

create index if not exists crm_opportunities_closure_idx
  on public.crm_opportunities(account_id, chiusa_il, chiusura_prevista, data_ricontatto);
create index if not exists crm_activities_next_step_idx
  on public.crm_activities(account_id, opportunity_id, stato, data_attivita);
create index if not exists crm_loss_reasons_type_idx
  on public.crm_loss_reasons(crm_tipo, attivo, ordine);

drop trigger if exists trg_crm_workflow_settings_updated on public.crm_workflow_settings;
create trigger trg_crm_workflow_settings_updated before update on public.crm_workflow_settings
for each row execute function public.crm_set_updated_at();
drop trigger if exists trg_crm_loss_reasons_updated on public.crm_loss_reasons;
create trigger trg_crm_loss_reasons_updated before update on public.crm_loss_reasons
for each row execute function public.crm_set_updated_at();

create or replace function public.crm_audit_workflow_configuration()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.crm_audit_log(utente_id,entita_tipo,entita_id,operazione,dettagli)
  values(public.workspace_current_profile_id(),tg_table_name,
    case when tg_table_name in ('crm_loss_reasons','crm_opportunity_stages') then coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id')::uuid else null end,
    lower(tg_op),jsonb_build_object('old',case when tg_op='INSERT' then null else to_jsonb(old) end,'new',case when tg_op='DELETE' then null else to_jsonb(new) end));
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
revoke all on function public.crm_audit_workflow_configuration() from public,anon,authenticated;
drop trigger if exists crm_workflow_settings_audit on public.crm_workflow_settings;
create trigger crm_workflow_settings_audit after insert or update or delete on public.crm_workflow_settings for each row execute function public.crm_audit_workflow_configuration();
drop trigger if exists crm_loss_reasons_audit on public.crm_loss_reasons;
create trigger crm_loss_reasons_audit after insert or update or delete on public.crm_loss_reasons for each row execute function public.crm_audit_workflow_configuration();
drop trigger if exists crm_stage_configuration_audit on public.crm_opportunity_stages;
create trigger crm_stage_configuration_audit after update of probabilita_default,soglia_aging_giorni on public.crm_opportunity_stages for each row execute function public.crm_audit_workflow_configuration();

alter table public.crm_workflow_settings enable row level security;
alter table public.crm_loss_reasons enable row level security;

drop policy if exists "crm workflow settings read" on public.crm_workflow_settings;
create policy "crm workflow settings read" on public.crm_workflow_settings
for select to authenticated
using (public.crm_has_module_level(public.crm_module_for_type(crm_tipo), 'lettura'));

drop policy if exists "crm workflow settings admin" on public.crm_workflow_settings;
create policy "crm workflow settings admin" on public.crm_workflow_settings
for all to authenticated
using (public.crm_has_module_level(public.crm_module_for_type(crm_tipo), 'amministrazione'))
with check (public.crm_has_module_level(public.crm_module_for_type(crm_tipo), 'amministrazione'));

drop policy if exists "crm loss reasons read" on public.crm_loss_reasons;
create policy "crm loss reasons read" on public.crm_loss_reasons
for select to authenticated
using (public.crm_has_module_level(public.crm_module_for_type(crm_tipo), 'lettura'));

drop policy if exists "crm loss reasons admin" on public.crm_loss_reasons;
create policy "crm loss reasons admin" on public.crm_loss_reasons
for all to authenticated
using (public.crm_has_module_level(public.crm_module_for_type(crm_tipo), 'amministrazione'))
with check (public.crm_has_module_level(public.crm_module_for_type(crm_tipo), 'amministrazione'));

revoke all on public.crm_workflow_settings, public.crm_loss_reasons from public, anon;
grant select on public.crm_workflow_settings, public.crm_loss_reasons to authenticated;
grant all on public.crm_workflow_settings, public.crm_loss_reasons to service_role;
grant insert, update, delete on public.crm_workflow_settings, public.crm_loss_reasons to authenticated;

drop policy if exists "crm opportunity workspace links write" on public.crm_workspace_links;
create policy "crm opportunity workspace links write" on public.crm_workspace_links
for all to authenticated
using (
  crm_entity_type = 'opportunity' and exists (
    select 1 from public.crm_opportunities o join public.crm_accounts a on a.id=o.account_id
    where o.id=crm_entity_id
      and public.crm_has_module_level(public.crm_module_for_type(a.tipo),'scrittura')
      and public.crm_row_visible(coalesce(o.responsabile_id,a.responsabile_id),coalesce(o.reparto_id,a.reparto_id),public.crm_module_for_type(a.tipo))
  )
)
with check (
  crm_entity_type = 'opportunity' and workspace_entity_type = 'project' and exists (
    select 1 from public.crm_opportunities o join public.crm_accounts a on a.id=o.account_id
    where o.id=crm_entity_id
      and public.crm_has_module_level(public.crm_module_for_type(a.tipo),'scrittura')
      and public.crm_row_visible(coalesce(o.responsabile_id,a.responsabile_id),coalesce(o.reparto_id,a.reparto_id),public.crm_module_for_type(a.tipo))
  )
);

create or replace function public.crm_transition_opportunity(
  p_opportunity_id uuid,
  p_stage_id uuid,
  p_valore_finale numeric default null,
  p_motivo_perdita_id uuid default null,
  p_motivo_perdita text default null,
  p_concorrente text default null,
  p_data_ricontatto date default null
) returns public.crm_opportunities
language plpgsql security invoker set search_path = public as $$
declare
  v_opportunity public.crm_opportunities%rowtype;
  v_account public.crm_accounts%rowtype;
  v_stage public.crm_opportunity_stages%rowtype;
  v_reason public.crm_loss_reasons%rowtype;
begin
  select * into v_opportunity from public.crm_opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'Opportunita non trovata o non autorizzata'; end if;
  select * into v_account from public.crm_accounts where id = v_opportunity.account_id;
  if not public.crm_has_module_level(public.crm_module_for_type(v_account.tipo), 'scrittura')
     or not public.crm_row_visible(coalesce(v_opportunity.responsabile_id,v_account.responsabile_id), coalesce(v_opportunity.reparto_id,v_account.reparto_id), public.crm_module_for_type(v_account.tipo)) then
    raise exception 'Modifica opportunita non autorizzata';
  end if;
  select * into v_stage from public.crm_opportunity_stages where id = p_stage_id and crm_tipo = v_account.tipo and attiva;
  if not found then raise exception 'Fase non valida per questa pipeline'; end if;
  if v_stage.finale and not v_stage.vinta then
    if p_motivo_perdita_id is null then raise exception 'Il motivo della perdita e obbligatorio'; end if;
    select * into v_reason from public.crm_loss_reasons where id = p_motivo_perdita_id and crm_tipo = v_account.tipo and attivo;
    if not found then raise exception 'Motivo della perdita non valido'; end if;
  end if;
  update public.crm_opportunities
  set stage_id = v_stage.id,
      probabilita = case when v_stage.vinta then 100 when v_stage.finale then 0 else coalesce(v_stage.probabilita_default, probabilita) end,
      chiusa_il = case when v_stage.finale then now() else null end,
      valore_finale = case when v_stage.finale then coalesce(p_valore_finale, valore) else valore_finale end,
      motivo_perdita_id = case when v_stage.finale and not v_stage.vinta then p_motivo_perdita_id else null end,
      motivo_perdita = case when v_stage.finale and not v_stage.vinta then nullif(trim(p_motivo_perdita),'') else null end,
      concorrente = case when v_stage.finale and not v_stage.vinta then nullif(trim(p_concorrente),'') else concorrente end,
      data_ricontatto = case when v_stage.finale and not v_stage.vinta then p_data_ricontatto else null end
  where id = p_opportunity_id
  returning * into v_opportunity;
  insert into public.crm_audit_log(utente_id,entita_tipo,entita_id,operazione,dettagli)
  values (public.workspace_current_profile_id(),'opportunity',v_opportunity.id,
    case when v_stage.vinta then 'opportunita_vinta' when v_stage.finale then 'opportunita_persa' else 'fase_opportunita_modificata' end,
    jsonb_build_object('stage_id',v_stage.id,'stage',v_stage.codice,'probabilita',v_opportunity.probabilita,'valore_finale',v_opportunity.valore_finale,'motivo_perdita_id',v_opportunity.motivo_perdita_id));
  return v_opportunity;
end;
$$;

create or replace function public.crm_complete_activity(
  p_activity_id uuid,
  p_esito text default null,
  p_prossima_azione text default null,
  p_prossima_data timestamptz default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_activity public.crm_activities%rowtype;
  v_next_id uuid;
begin
  select * into v_activity from public.crm_activities where id = p_activity_id for update;
  if not found then raise exception 'Attivita non trovata o non autorizzata'; end if;
  if not public.crm_has_module_level(public.crm_module_for_type(v_activity.crm_tipo), 'scrittura')
     or not public.crm_row_visible(v_activity.responsabile_id,v_activity.reparto_id,public.crm_module_for_type(v_activity.crm_tipo)) then
    raise exception 'Modifica attivita non autorizzata';
  end if;
  update public.crm_activities
  set stato='completata', completata_il=now(), esito=nullif(trim(p_esito),''), prossima_azione=nullif(trim(p_prossima_azione),'')
  where id=p_activity_id;
  if p_prossima_data is not null and nullif(trim(p_prossima_azione),'') is not null then
    insert into public.crm_activities(crm_tipo,account_id,opportunity_id,tipo,titolo,descrizione,stato,data_attivita,responsabile_id,reparto_id,creato_da)
    values(v_activity.crm_tipo,v_activity.account_id,v_activity.opportunity_id,'follow_up',trim(p_prossima_azione),null,'pianificata',p_prossima_data,v_activity.responsabile_id,v_activity.reparto_id,public.workspace_current_profile_id())
    returning id into v_next_id;
  end if;
  insert into public.crm_audit_log(utente_id,entita_tipo,entita_id,operazione,dettagli)
  values(public.workspace_current_profile_id(),'activity',v_activity.id,'attivita_completata',jsonb_build_object('esito',p_esito,'next_activity_id',v_next_id,'next_at',p_prossima_data));
  return jsonb_build_object('activity_id',v_activity.id,'next_activity_id',v_next_id);
end;
$$;

revoke all on function public.crm_transition_opportunity(uuid,uuid,numeric,uuid,text,text,date) from public, anon;
grant execute on function public.crm_transition_opportunity(uuid,uuid,numeric,uuid,text,text,date) to authenticated, service_role;
revoke all on function public.crm_complete_activity(uuid,text,text,timestamptz) from public, anon;
grant execute on function public.crm_complete_activity(uuid,text,text,timestamptz) to authenticated, service_role;

comment on table public.crm_workflow_settings is 'Parametri CRM operativi configurabili per PRIVATE e B2B.';
comment on column public.crm_opportunity_stages.soglia_aging_giorni is 'Giorni nella fase oltre i quali l opportunita richiede attenzione.';
comment on function public.crm_transition_opportunity(uuid,uuid,numeric,uuid,text,text,date) is 'Transizione atomica e auditata con semantica obbligatoria vinta/persa.';
comment on function public.crm_complete_activity(uuid,text,text,timestamptz) is 'Completa una attivita e crea opzionalmente il prossimo passo nello stesso flusso.';

create or replace function public.crm_account_commercial_snapshot(
  p_account_id uuid,
  p_from date,
  p_to date
) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_account public.crm_accounts%rowtype;
  v_settings public.crm_workflow_settings%rowtype;
  v_result jsonb;
begin
  select * into v_account from public.crm_accounts where id=p_account_id;
  if not found or not public.crm_row_visible(v_account.responsabile_id,v_account.reparto_id,public.crm_module_for_type(v_account.tipo)) then
    raise exception 'Cliente non trovato o non autorizzato';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'Intervallo non valido'; end if;
  select * into v_settings from public.crm_workflow_settings where crm_tipo=v_account.tipo;
  with order_dates as (
    select o.id,o.data_ordine,o.totale_documento,
      lag(o.data_ordine) over(order by o.data_ordine) previous_date
    from public.crm_order_kpi_source o
    where o.codice_cliente=v_account.codice_cliente_mexal
  ), order_stats as (
    select count(*)::bigint total_count,coalesce(sum(totale_documento),0)::numeric total_value,
      count(*) filter(where data_ordine between p_from and p_to)::bigint period_count,
      coalesce(sum(totale_documento) filter(where data_ordine between p_from and p_to),0)::numeric period_value,
      min(data_ordine) first_date,max(data_ordine) last_date,
      avg(data_ordine-previous_date) filter(where previous_date is not null) average_days
    from order_dates
  ), invoice_stats as (
    select count(*)::bigint total_count,coalesce(sum(totale_documento),0)::numeric total_value,
      count(*) filter(where data_documento between p_from and p_to)::bigint period_count,
      coalesce(sum(totale_documento) filter(where data_documento between p_from and p_to),0)::numeric period_value,
      min(data_documento) first_date,max(data_documento) last_date
    from public.mexal_fatture_vendita where codice_cliente=v_account.codice_cliente_mexal
  ), opportunity_stats as (
    select count(*) filter(where not coalesce(s.finale,false))::bigint open_count,
      coalesce(sum(o.valore) filter(where not coalesce(s.finale,false)),0)::numeric pipeline_value,
      coalesce(sum(o.valore*coalesce(o.probabilita,0)/100.0) filter(where not coalesce(s.finale,false)),0)::numeric weighted_value,
      count(*) filter(where not coalesce(s.finale,false) and o.chiusura_prevista<current_date)::bigint overdue_count
    from public.crm_opportunities o left join public.crm_opportunity_stages s on s.id=o.stage_id
    where o.account_id=v_account.id
  ), activity_stats as (
    select max(completata_il) last_completed,
      min(data_attivita) filter(where stato<>'completata' and data_attivita>=now()) next_at,
      count(*) filter(where stato<>'completata' and data_attivita<now())::bigint overdue_count
    from public.crm_activities where account_id=v_account.id
  )
  select jsonb_build_object(
    'orders',jsonb_build_object('lifetime_count',o.total_count,'lifetime_value',o.total_value,'period_count',o.period_count,'period_value',o.period_value,'first_date',o.first_date,'last_date',o.last_date,'average_value',case when o.total_count>0 then o.total_value/o.total_count else 0 end,'average_days',round(o.average_days::numeric,1)),
    'invoices',jsonb_build_object('lifetime_count',i.total_count,'lifetime_value',i.total_value,'period_count',i.period_count,'period_value',i.period_value,'first_date',i.first_date,'last_date',i.last_date),
    'opportunities',jsonb_build_object('open_count',p.open_count,'pipeline_value',p.pipeline_value,'weighted_value',p.weighted_value,'overdue_count',p.overdue_count),
    'activities',jsonb_build_object('last_completed',a.last_completed,'next_at',a.next_at,'overdue_count',a.overdue_count),
    'b2b',case when v_account.tipo='b2b' then jsonb_build_object(
      'classification',case when o.total_count=0 then 'prospect' when o.total_count=1 then 'primo_ordine' when o.last_date>=current_date-coalesce(round(o.average_days)::int,v_settings.riordino_giorni_default) then 'riordino' when o.last_date>=current_date-(coalesce(round(o.average_days)::int,v_settings.riordino_giorni_default)*v_settings.rischio_moltiplicatore)::int then 'a_rischio' when o.last_date>=current_date-(coalesce(round(o.average_days)::int,v_settings.riordino_giorni_default)*v_settings.dormiente_moltiplicatore)::int then 'dormiente' else 'perso' end,
      'expected_reorder_date',o.last_date+coalesce(round(o.average_days)::int,v_settings.riordino_giorni_default),
      'days_since_last_order',case when o.last_date is null then null else current_date-o.last_date end,
      'new_customer',o.first_date>=current_date-v_settings.nuovi_clienti_giorni
    ) else null end
  ) into v_result from order_stats o cross join invoice_stats i cross join opportunity_stats p cross join activity_stats a;
  return v_result;
end;
$$;

create or replace function public.crm_account_journey(p_account_id uuid)
returns table(event_at timestamptz,event_type text,title text,detail text,entity_id text)
language sql stable security invoker set search_path=public as $$
  with allowed as (
    select a.* from public.crm_accounts a where a.id=p_account_id
      and public.crm_row_visible(a.responsabile_id,a.reparto_id,public.crm_module_for_type(a.tipo))
  ), events as (
    select coalesce(a.completata_il,a.data_attivita,a.creato_il) event_at,'activity'::text event_type,a.titolo title,concat_ws(' · ',a.tipo,a.stato,a.esito) detail,a.id::text entity_id from public.crm_activities a join allowed x on x.id=a.account_id
    union all
    select h.changed_at,'stage',coalesce(s.nome,'Cambio fase'),coalesce(f.nome||' → ','')||coalesce(s.nome,'Senza fase'),h.opportunity_id::text from public.crm_opportunity_stage_history h join public.crm_opportunities o on o.id=h.opportunity_id join allowed x on x.id=o.account_id left join public.crm_opportunity_stages f on f.id=h.from_stage_id left join public.crm_opportunity_stages s on s.id=h.to_stage_id
    union all
    select b.aggiornato_il,'brief',b.titolo,b.stato,b.id::text from public.crm_briefs b join allowed x on x.id=b.account_id
    union all
    select l.creato_il,'project','Progetto Workspace collegato',l.workspace_entity_id::text,l.workspace_entity_id::text from public.crm_workspace_links l join public.crm_opportunities o on l.crm_entity_type='opportunity' and l.crm_entity_id=o.id join allowed x on x.id=o.account_id where l.workspace_entity_type='project'
  ) select * from events order by event_at desc;
$$;

revoke all on function public.crm_account_commercial_snapshot(uuid,date,date), public.crm_account_journey(uuid) from public,anon;
grant execute on function public.crm_account_commercial_snapshot(uuid,date,date), public.crm_account_journey(uuid) to authenticated,service_role;
comment on function public.crm_account_commercial_snapshot(uuid,date,date) is 'Snapshot server-side cliente: ordini deduplicati Workspace/Mexal, fatture, pipeline, attivita e ciclo B2B.';
comment on function public.crm_account_journey(uuid) is 'Timeline CRM unificata autorizzata per account.';

create or replace function public.crm_canonical_commercial_snapshot(p_customer_code text,p_crm_type text,p_from date,p_to date)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare v_settings public.crm_workflow_settings%rowtype; v_result jsonb;
begin
  if not public.crm_customer_classification_visible(p_customer_code,p_crm_type) then raise exception 'Cliente non trovato o non autorizzato'; end if;
  select * into v_settings from public.crm_workflow_settings where crm_tipo=p_crm_type;
  with dates as (
    select data_ordine,totale_documento,lag(data_ordine) over(order by data_ordine) previous_date
    from public.crm_order_kpi_source where codice_cliente=p_customer_code
  ), orders as (
    select count(*)::bigint total_count,coalesce(sum(totale_documento),0)::numeric total_value,min(data_ordine) first_date,max(data_ordine) last_date,avg(data_ordine-previous_date) filter(where previous_date is not null) average_days,
      count(*) filter(where data_ordine between p_from and p_to)::bigint period_count,coalesce(sum(totale_documento) filter(where data_ordine between p_from and p_to),0)::numeric period_value from dates
  ) select jsonb_build_object('orders',jsonb_build_object('lifetime_count',o.total_count,'lifetime_value',o.total_value,'period_count',o.period_count,'period_value',o.period_value,'first_date',o.first_date,'last_date',o.last_date,'average_value',case when o.total_count>0 then o.total_value/o.total_count else 0 end,'average_days',round(o.average_days::numeric,1)),
    'b2b',case when p_crm_type='b2b' then jsonb_build_object('classification',case when o.total_count=0 then 'prospect' when o.total_count=1 then 'primo_ordine' when o.last_date>=current_date-coalesce(round(o.average_days)::int,v_settings.riordino_giorni_default) then 'riordino' when o.last_date>=current_date-(coalesce(round(o.average_days)::int,v_settings.riordino_giorni_default)*v_settings.rischio_moltiplicatore)::int then 'a_rischio' when o.last_date>=current_date-(coalesce(round(o.average_days)::int,v_settings.riordino_giorni_default)*v_settings.dormiente_moltiplicatore)::int then 'dormiente' else 'perso' end,'expected_reorder_date',o.last_date+coalesce(round(o.average_days)::int,v_settings.riordino_giorni_default),'days_since_last_order',case when o.last_date is null then null else current_date-o.last_date end,'new_customer',o.first_date>=current_date-v_settings.nuovi_clienti_giorni) else null end) into v_result from orders o;
  return v_result;
end; $$;
revoke all on function public.crm_canonical_commercial_snapshot(text,text,date,date) from public,anon;
grant execute on function public.crm_canonical_commercial_snapshot(text,text,date,date) to authenticated,service_role;

create or replace function public.crm_b2b_lifecycle_summary()
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare v_settings public.crm_workflow_settings%rowtype; v_result jsonb;
begin
  if not public.crm_has_module_level('crm_b2b','lettura') then raise exception 'Accesso CRM B2B non autorizzato'; end if;
  select * into v_settings from public.crm_workflow_settings where crm_tipo='b2b';
  with customers as (select codice_cliente from public.crm_classified_customers where area_crm='b2b' and crm_active), dates as (
    select c.codice_cliente,o.data_ordine,lag(o.data_ordine) over(partition by c.codice_cliente order by o.data_ordine) previous_date from customers c left join public.crm_order_kpi_source o on o.codice_cliente=c.codice_cliente
  ), stats as (
    select codice_cliente,count(data_ordine)::bigint order_count,min(data_ordine) first_date,max(data_ordine) last_date,avg(data_ordine-previous_date) filter(where previous_date is not null) average_days from dates group by codice_cliente
  ), classified as (
    select *,case when order_count=0 then 'prospect' when order_count=1 then 'primo_ordine' when last_date>=current_date-coalesce(round(average_days)::int,v_settings.riordino_giorni_default) then 'riordino' when last_date>=current_date-(coalesce(round(average_days)::int,v_settings.riordino_giorni_default)*v_settings.rischio_moltiplicatore)::int then 'a_rischio' when last_date>=current_date-(coalesce(round(average_days)::int,v_settings.riordino_giorni_default)*v_settings.dormiente_moltiplicatore)::int then 'dormiente' else 'perso' end classification from stats
  ) select jsonb_build_object('total',count(*),'prospects',count(*) filter(where classification='prospect'),'first_order',count(*) filter(where classification='primo_ordine'),'reorders',count(*) filter(where order_count>1),'at_risk',count(*) filter(where classification='a_rischio'),'dormant',count(*) filter(where classification='dormiente'),'lost',count(*) filter(where classification='perso'),'new_customers',count(*) filter(where first_date>=current_date-v_settings.nuovi_clienti_giorni)) into v_result from classified;
  return v_result;
end; $$;
revoke all on function public.crm_b2b_lifecycle_summary() from public,anon;
grant execute on function public.crm_b2b_lifecycle_summary() to authenticated,service_role;

create or replace function public.crm_opportunity_analytics(p_crm_type text,p_from date,p_to date)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare v_result jsonb;
begin
  if p_crm_type not in ('conto_terzi','b2b') or p_from is null or p_to is null or p_from>p_to then
    raise exception 'Parametri analytics CRM non validi';
  end if;
  if not public.crm_has_module_level(public.crm_module_for_type(p_crm_type),'lettura') then
    raise exception 'Accesso analytics CRM non autorizzato';
  end if;
  with scoped as (
    select o.*,s.finale,s.vinta
    from public.crm_opportunities o
    join public.crm_accounts a on a.id=o.account_id and a.tipo=p_crm_type
    left join public.crm_opportunity_stages s on s.id=o.stage_id
    where coalesce(o.aperta_il,o.creato_il)::date between p_from and p_to
  ), totals as (
    select
      count(*)::bigint total_count,
      count(*) filter(where not coalesce(finale,false))::bigint open_count,
      count(*) filter(where coalesce(finale,false) and coalesce(vinta,false))::bigint won_count,
      count(*) filter(where coalesce(finale,false) and not coalesce(vinta,false))::bigint lost_count,
      coalesce(sum(valore) filter(where not coalesce(finale,false)),0)::numeric pipeline_value,
      coalesce(sum(valore*coalesce(probabilita,0)/100.0) filter(where not coalesce(finale,false)),0)::numeric weighted_value,
      coalesce(sum(coalesce(valore_finale,valore)) filter(where coalesce(finale,false) and coalesce(vinta,false)),0)::numeric won_value,
      coalesce(sum(coalesce(valore_finale,valore)) filter(where coalesce(finale,false) and not coalesce(vinta,false)),0)::numeric lost_value,
      avg(extract(epoch from (chiusa_il-coalesce(aperta_il,creato_il)))/86400.0) filter(where chiusa_il is not null)::numeric average_cycle_days
    from scoped
  ), reasons as (
    select coalesce(jsonb_agg(jsonb_build_object('name',coalesce(r.nome,s.motivo_perdita,'Non specificato'),'count',s.reason_count,'value',s.reason_value) order by s.reason_count desc),'[]'::jsonb) value
    from (
      select motivo_perdita_id,motivo_perdita,count(*)::bigint reason_count,coalesce(sum(coalesce(valore_finale,valore)),0)::numeric reason_value
      from scoped where coalesce(finale,false) and not coalesce(vinta,false)
      group by motivo_perdita_id,motivo_perdita
    ) s left join public.crm_loss_reasons r on r.id=s.motivo_perdita_id
  )
  select jsonb_build_object(
    'total',t.total_count,'open',t.open_count,'won',t.won_count,'lost',t.lost_count,
    'conversion_rate',case when t.won_count+t.lost_count>0 then round(t.won_count*100.0/(t.won_count+t.lost_count),1) else null end,
    'pipeline_value',t.pipeline_value,'weighted_value',t.weighted_value,
    'won_value',t.won_value,'lost_value',t.lost_value,
    'average_cycle_days',round(t.average_cycle_days,1),'loss_reasons',r.value
  ) into v_result from totals t cross join reasons r;
  return v_result;
end; $$;
revoke all on function public.crm_opportunity_analytics(text,date,date) from public,anon;
grant execute on function public.crm_opportunity_analytics(text,date,date) to authenticated,service_role;
comment on function public.crm_opportunity_analytics(text,date,date) is 'KPI opportunita aggregati lato server sul perimetro RLS autorizzato.';

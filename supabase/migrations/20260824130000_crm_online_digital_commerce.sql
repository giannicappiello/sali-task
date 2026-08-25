begin;

-- CRM Online Digital Commerce: moduli separabili solo dove serve un'autorizzazione distinta.
update public.workspace_moduli
set nome='CRM Online',
    descrizione='Centro operativo Digital Commerce & Marketing.',
    dipendenze_alternative=array['crm_online_ecommerce','crm_online_mailing','crm_online_amazon','crm_online_adv'],
    aggiornato_il=now()
where codice='crm_online';

insert into public.workspace_moduli
  (codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,
   assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,icona,dipendenze)
values
 ('crm_online_ecommerce','CRM Online · Ecommerce','Sito, ordini, clienti e KPI ecommerce.','modulo','crm','/crm/online/ecommerce','workspace',false,true,true,false,true,681,'shopping-bag',array['crm_online']),
 ('crm_online_mailing','CRM Online · Mailing','Liste, campagne, automazioni e risultati mailing.','modulo','crm','/crm/online/mailing','workspace',false,true,true,false,true,682,'mail',array['crm_online']),
 ('crm_online_amazon','CRM Online · Amazon','Amazon Seller, mapping prodotti e Amazon Ads.','modulo','crm','/crm/online/amazon','workspace',false,true,true,false,true,683,'store',array['crm_online']),
 ('crm_online_adv','CRM Online · ADV','Meta Ads e Google Ads.','modulo','crm','/crm/online/adv','workspace',false,true,true,false,true,684,'chart',array['crm_online'])
on conflict (codice) do update set nome=excluded.nome,descrizione=excluded.descrizione,area='crm',
 percorso=excluded.percorso,provider='workspace',assegnabile_reparto=true,configurabile_ruolo=true,
 mostra_menu=false,attivo=true,ordine=excluded.ordine,icona=excluded.icona,dipendenze=excluded.dipendenze;
update public.workspace_moduli set dipendenze='{}',aggiornato_il=now()
where codice in ('crm_online_ecommerce','crm_online_mailing','crm_online_amazon','crm_online_adv');


-- Gli utenti Online già operativi conservano l'accesso completo; in seguito i quattro moduli sono separabili dal pannello.
insert into public.reparti_moduli(reparto_id,modulo)
select rm.reparto_id,m.codice from public.reparti_moduli rm
cross join (values('crm_online_ecommerce'),('crm_online_mailing'),('crm_online_amazon'),('crm_online_adv')) m(codice)
where rm.modulo='crm_online' on conflict do nothing;
insert into public.ruoli_moduli(ruolo_id,modulo,livello_accesso)
select rm.ruolo_id,m.codice,rm.livello_accesso from public.ruoli_moduli rm
cross join (values('crm_online_ecommerce'),('crm_online_mailing'),('crm_online_amazon'),('crm_online_adv')) m(codice)
where rm.modulo='crm_online' on conflict do nothing;

insert into public.workspace_schermate
 (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,icona,metadati,ultima_sincronizzazione)
values
 ('crm.online.digital','Panoramica Digital','Dashboard Digital Commerce & Marketing multicanale.','workspace','/crm/online/digital','crm.online.digital',false,true,400,'crm','chart','{}',now()),
 ('crm.online.ecommerce','Ecommerce','Ordini, vendite e KPI del sito ecommerce configurato.','workspace','/crm/online/ecommerce','crm.online.ecommerce',false,true,410,'crm','shopping-bag','{}',now()),
 ('crm.online.mailing','Mailing','Liste, segmenti, campagne e performance mailing.','workspace','/crm/online/mailing','crm.online.mailing',false,true,420,'crm','mail','{}',now()),
 ('crm.online.amazon','Amazon','Amazon Seller, mapping SKU e Amazon Ads.','workspace','/crm/online/amazon','crm.online.amazon',false,true,430,'crm','store','{}',now()),
 ('crm.online.adv','ADV','Campagne e metriche Meta Ads e Google Ads.','workspace','/crm/online/adv','crm.online.adv',false,true,440,'crm','chart','{}',now()),
 ('crm.online.creators_v2','Creator / Social','Creator, contenuti, costi, revenue e ROI.','workspace','/crm/online/creators','crm.online.creators',false,true,450,'crm','sparkles','{}',now()),
 ('crm.online.journey_v2','Customer Journey','Timeline autorizzata e paginata degli eventi cliente.','workspace','/crm/online/journey','crm.online.journey',false,true,460,'crm','workflow','{}',now()),
 ('crm.online.analytics','Analisi Digital','Analisi per canale, prodotto, campagna, marketplace e creator.','workspace','/crm/online/analytics','crm.online.analytics',false,true,470,'crm','chart','{}',now()),
 ('crm.online.ai','AI Digital Assistant','Analisi multicanale, decisione umana e attività Workspace.','workspace','/crm/online/ai','crm.online.ai',false,true,480,'crm','bot','{}',now()),
 ('impostazioni.crm_digital','Collegamenti Digital','Provider, endpoint, account e pianificazione dei connettori CRM Online.','workspace','/settings/crm-digital','settings.crm_digital',false,true,75,'amministrazione','plug','{"required_permissions":["settings.manage","integrations.configure"]}',now()),
 ('integrazioni.crm_digital','Digital Commerce','Stato, diagnostica e storico sincronizzazioni dei canali Digital.','workspace','/integrations/crm-digital','integrations.crm_digital',false,true,980,'amministrazione','plug','{"required_permissions":["integrations.configure"]}',now())
on conflict (codice) do update set nome=excluded.nome,descrizione=excluded.descrizione,
 percorso=excluded.percorso,chiave_componente=excluded.chiave_componente,attiva=true,ordine=excluded.ordine,
 area=excluded.area,icona=excluded.icona,metadati=workspace_schermate.metadati||excluded.metadati,ultima_sincronizzazione=now();

insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values
 ('crm_online','crm.online.digital',10,true,true),
 ('crm_online_ecommerce','crm.online.ecommerce',10,true,true),
 ('crm_online_mailing','crm.online.mailing',10,true,true),
 ('crm_online_amazon','crm.online.amazon',10,true,true),
 ('crm_online_adv','crm.online.adv',10,true,true),
 ('crm_online','crm.online.creators_v2',50,false,true),
 ('crm_online','crm.online.journey_v2',60,false,true),
 ('crm_online','crm.online.analytics',70,false,true),
 ('crm_ai','crm.online.ai',20,false,true),
 ('impostazioni','impostazioni.crm_digital',75,false,true),
 ('integrazioni','integrazioni.crm_digital',80,false,true)
on conflict (modulo_codice,schermata_codice) do update set ordine=excluded.ordine,
 predefinita=excluded.predefinita,visibile_menu=excluded.visibile_menu;

create table if not exists public.crm_external_connections (
 id uuid primary key default gen_random_uuid(),
 tipo text not null check(tipo in ('ecommerce','mailing','amazon_seller','amazon_ads','meta_ads','google_ads')),
 provider text, nome text not null, stato text not null default 'non_configurato'
   check(stato in ('non_configurato','configurazione_parziale','pronto','connesso','errore','disabilitato')),
 endpoint_url text, site_url text, external_account_id text, marketplace_ids text[] not null default '{}',
 configurazione jsonb not null default '{}', secret_references jsonb not null default '{}',
 credenziali_stato text not null default 'mancanti' check(credenziali_stato in ('mancanti','parziali','configurate','scadute','errore')),
 abilitata boolean not null default false, sync_mode text not null default 'incremental' check(sync_mode in ('full','incremental')),
 intervallo_minuti integer check(intervallo_minuti is null or intervallo_minuti between 5 and 10080),
 ultimo_sync_il timestamptz, prossima_run_il timestamptz, ultimo_errore text,
 creata_da uuid references public.utenti(id) on delete set null,
 creata_il timestamptz not null default now(), aggiornata_il timestamptz not null default now(), unique(tipo,nome)
);
comment on column public.crm_external_connections.secret_references is 'Solo nomi/riferimenti di variabili protette; mai token o chiavi.';
do $$ begin
 if not exists(select 1 from pg_constraint where conname='crm_external_connections_https_check') then
  alter table public.crm_external_connections add constraint crm_external_connections_https_check
   check((endpoint_url is null or endpoint_url ~ '^https://') and (site_url is null or site_url ~ '^https://'));
 end if;
 if not exists(select 1 from pg_constraint where conname='crm_external_connections_no_inline_secrets_check') then
  alter table public.crm_external_connections add constraint crm_external_connections_no_inline_secrets_check
   check(configurazione::text !~* '(access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password)');
 end if;
end $$;


create table if not exists public.crm_external_accounts (
 id uuid primary key default gen_random_uuid(), connection_id uuid not null references public.crm_external_connections(id) on delete cascade,
 external_id text not null, nome text, tipo text, marketplace text, valuta text default 'EUR', metadati jsonb not null default '{}',
 responsabile_id uuid references public.utenti(id) on delete set null, reparto_id uuid references public.reparti(id) on delete set null,
 creato_il timestamptz not null default now(), aggiornato_il timestamptz not null default now(), unique(connection_id,external_id)
);
create table if not exists public.crm_external_customers (
 id uuid primary key default gen_random_uuid(), connection_id uuid not null references public.crm_external_connections(id) on delete cascade,
 external_id text not null, account_id uuid references public.crm_accounts(id) on delete set null,
 identity_status text not null default 'unmatched' check(identity_status in ('matched','probable','unmatched')),
 identity_method text, email_hash text, first_order_at timestamptz, last_order_at timestamptz, order_count integer,
 total_value numeric(14,2), metadati_minimi jsonb not null default '{}',
 responsabile_id uuid references public.utenti(id) on delete set null,reparto_id uuid references public.reparti(id) on delete set null,
 creato_il timestamptz not null default now(),aggiornato_il timestamptz not null default now(),unique(connection_id,external_id)
);
create index if not exists crm_external_customers_identity_idx on public.crm_external_customers(identity_status,account_id);

create table if not exists public.crm_external_orders (
 id uuid primary key default gen_random_uuid(),connection_id uuid not null references public.crm_external_connections(id) on delete cascade,
 external_id text not null,external_customer_id uuid references public.crm_external_customers(id) on delete set null,
 account_id uuid references public.crm_accounts(id) on delete set null,marketplace text,stato text,ordered_at timestamptz not null,
 currency text not null default 'EUR',gross_revenue numeric(14,2),discounts numeric(14,2),refunds numeric(14,2),fees numeric(14,2),net_revenue numeric(14,2),
 coupon_code text,traffic_source text,utm jsonb not null default '{}',attribution_method text not null default 'unknown'
   check(attribution_method in ('provider-reported','utm','last-touch','coupon/code','creator-code','direct','unknown')),
 raw_summary jsonb not null default '{}',responsabile_id uuid references public.utenti(id) on delete set null,reparto_id uuid references public.reparti(id) on delete set null,
 creato_il timestamptz not null default now(),aggiornato_il timestamptz not null default now(),unique(connection_id,external_id)
);
create index if not exists crm_external_orders_period_idx on public.crm_external_orders(ordered_at desc,connection_id,marketplace);
create index if not exists crm_external_orders_account_idx on public.crm_external_orders(account_id,ordered_at desc);

create table if not exists public.crm_external_order_lines (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.crm_external_orders(id) on delete cascade,
 external_line_id text not null,external_sku text,asin text,product_id uuid references public.prodotti(id) on delete set null,
 quantity numeric(14,3),unit_price numeric(14,2),discount numeric(14,2),refund numeric(14,2),line_revenue numeric(14,2),
 metadati jsonb not null default '{}',unique(order_id,external_line_id)
);
create index if not exists crm_external_order_lines_product_idx on public.crm_external_order_lines(product_id,external_sku);

create table if not exists public.crm_external_campaigns (
 id uuid primary key default gen_random_uuid(),connection_id uuid not null references public.crm_external_connections(id) on delete cascade,
 external_id text not null,crm_campaign_id uuid references public.crm_campaigns(id) on delete set null,
 parent_external_id text,nome text not null,livello text not null default 'campaign',stato text,
 started_at timestamptz,ended_at timestamptz,metadati jsonb not null default '{}',
 responsabile_id uuid references public.utenti(id) on delete set null,reparto_id uuid references public.reparti(id) on delete set null,
 creato_il timestamptz not null default now(),aggiornato_il timestamptz not null default now(),unique(connection_id,external_id,livello)
);
create table if not exists public.crm_external_metrics (
 id bigint generated by default as identity primary key,connection_id uuid not null references public.crm_external_connections(id) on delete cascade,
 external_campaign_id uuid references public.crm_external_campaigns(id) on delete cascade,metric_date date not null,
 channel text not null,marketplace text,product_id uuid references public.prodotti(id) on delete set null,creator_id uuid references public.crm_creators(id) on delete set null,
 impressions bigint,reach bigint,clicks bigint,delivered bigint,opens bigint,bounces bigint,unsubscribes bigint,orders numeric(14,3),conversions numeric(14,3),
 spend numeric(14,2),revenue numeric(14,2),fees numeric(14,2),attribution_method text not null default 'provider-reported',
 metadati jsonb not null default '{}',responsabile_id uuid references public.utenti(id) on delete set null,reparto_id uuid references public.reparti(id) on delete set null,
 unique(connection_id,external_campaign_id,metric_date,channel,marketplace,product_id,creator_id)
);
create index if not exists crm_external_metrics_filters_idx on public.crm_external_metrics(metric_date desc,channel,marketplace,product_id,creator_id);

create table if not exists public.crm_sync_runs (
 id uuid primary key default gen_random_uuid(),connection_id uuid not null references public.crm_external_connections(id) on delete cascade,
 sync_type text not null,mode text not null default 'incremental',status text not null default 'queued'
   check(status in ('queued','running','completed','partial','failed','cancelled','retrying')),
 idempotency_key text not null,started_at timestamptz,heartbeat_at timestamptz,completed_at timestamptz,next_retry_at timestamptz,
 cursor_value text,records_read integer not null default 0,records_inserted integer not null default 0,records_updated integer not null default 0,
 records_failed integer not null default 0,duration_ms bigint,error_code text,error_message text,details jsonb not null default '{}',
 triggered_by uuid references public.utenti(id) on delete set null,created_at timestamptz not null default now(),unique(connection_id,sync_type,idempotency_key)
);
create unique index if not exists crm_sync_runs_single_active_idx on public.crm_sync_runs(connection_id,sync_type) where status in ('queued','running','retrying');
create index if not exists crm_sync_runs_history_idx on public.crm_sync_runs(connection_id,created_at desc);

create table if not exists public.crm_marketing_consents (
 id uuid primary key default gen_random_uuid(),account_id uuid references public.crm_accounts(id) on delete cascade,
 external_customer_id uuid references public.crm_external_customers(id) on delete cascade,purpose text not null,
 status text not null check(status in ('granted','denied','withdrawn','unknown')),legal_basis text,source text,
 captured_at timestamptz,withdrawn_at timestamptz,proof_reference text,retention_until date,metadati_minimi jsonb not null default '{}',
 responsabile_id uuid references public.utenti(id) on delete set null,reparto_id uuid references public.reparti(id) on delete set null,
 creato_il timestamptz not null default now(),aggiornato_il timestamptz not null default now()
);
create index if not exists crm_marketing_consents_account_idx on public.crm_marketing_consents(account_id,purpose,captured_at desc);

create table if not exists public.crm_attribution_events (
 id uuid primary key default gen_random_uuid(),account_id uuid references public.crm_accounts(id) on delete set null,
 order_id uuid references public.crm_external_orders(id) on delete cascade,campaign_id uuid references public.crm_campaigns(id) on delete set null,
 creator_id uuid references public.crm_creators(id) on delete set null,method text not null
   check(method in ('provider-reported','utm','last-touch','coupon/code','creator-code','direct','unknown')),
 source text,occurred_at timestamptz not null,value numeric(14,2),confidence numeric(5,4) check(confidence between 0 and 1),evidence jsonb not null default '{}',
 responsabile_id uuid references public.utenti(id) on delete set null,reparto_id uuid references public.reparti(id) on delete set null,creato_il timestamptz not null default now()
);
create index if not exists crm_attribution_events_period_idx on public.crm_attribution_events(occurred_at desc,method,campaign_id,creator_id);

create table if not exists public.crm_product_mappings (
 id uuid primary key default gen_random_uuid(),connection_id uuid not null references public.crm_external_connections(id) on delete cascade,
 marketplace text,external_sku text not null,asin text,product_id uuid references public.prodotti(id) on delete set null,codice_mexal text,
 status text not null default 'unmatched' check(status in ('matched','probable','unmatched','ignored')),
 match_method text,verified_by uuid references public.utenti(id) on delete set null,verified_at timestamptz,
 creato_il timestamptz not null default now(),aggiornato_il timestamptz not null default now(),unique(connection_id,marketplace,external_sku)
);
create index if not exists crm_product_mappings_status_idx on public.crm_product_mappings(connection_id,status,marketplace);

alter table public.crm_campaigns add column if not exists canali text[] not null default '{}';
alter table public.crm_campaigns add column if not exists attribution_method text not null default 'unknown';
alter table public.crm_creators add column if not exists engagement numeric(8,4);
alter table public.crm_creators add column if not exists codice_sconto text;
alter table public.crm_creators add column if not exists tracking_url text;
alter table public.crm_creators add column if not exists revenue numeric(14,2);
alter table public.crm_creator_contents add column if not exists piattaforma text;
alter table public.crm_creator_contents add column if not exists formato text;
alter table public.crm_creator_contents add column if not exists product_id uuid references public.prodotti(id) on delete set null;
alter table public.crm_creator_contents add column if not exists pubblicato_il timestamptz;
alter table public.crm_customer_events drop constraint if exists crm_customer_events_fase_check;
alter table public.crm_customer_events add constraint crm_customer_events_fase_check check(fase in
 ('session','product_view','lead','visita','interesse','newsletter_signup','iscrizione','email_sent','email_open','email_click','add_to_cart','carrello','checkout_started','purchase','acquisto','repeat_purchase','riacquisto','ad_click','creator_touch','review','recensione','return','refund','loyalty'));

create or replace function public.crm_digital_module_for_connection(target_type text)
returns text language sql immutable as $$ select case
 when target_type='ecommerce' then 'crm_online_ecommerce'
 when target_type='mailing' then 'crm_online_mailing'
 when target_type in ('amazon_seller','amazon_ads') then 'crm_online_amazon'
 when target_type in ('meta_ads','google_ads') then 'crm_online_adv'
 else 'crm_online' end $$;

do $$ declare t text; begin foreach t in array array[
 'crm_external_connections','crm_external_accounts','crm_external_customers','crm_external_orders','crm_external_order_lines',
 'crm_external_campaigns','crm_external_metrics','crm_sync_runs','crm_marketing_consents','crm_attribution_events','crm_product_mappings'
] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;

create policy "digital connection admin read" on public.crm_external_connections for select to authenticated using
 (public.workspace_user_is_admin() or public.crm_has_module_level(public.crm_digital_module_for_connection(tipo),'lettura'));
create policy "digital connection admin write" on public.crm_external_connections for all to authenticated using
 (public.workspace_user_is_admin()) with check(public.workspace_user_is_admin());

create policy "digital accounts scoped" on public.crm_external_accounts for all to authenticated using
 (exists(select 1 from public.crm_external_connections c where c.id=connection_id and public.crm_row_visible(responsabile_id,reparto_id,public.crm_digital_module_for_connection(c.tipo))))
 with check(exists(select 1 from public.crm_external_connections c where c.id=connection_id and public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,public.crm_digital_module_for_connection(c.tipo)) and public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'scrittura')));
create policy "digital customers scoped" on public.crm_external_customers for all to authenticated using
 (exists(select 1 from public.crm_external_connections c where c.id=connection_id and public.crm_row_visible(responsabile_id,reparto_id,public.crm_digital_module_for_connection(c.tipo))))
 with check(exists(select 1 from public.crm_external_connections c where c.id=connection_id and public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,public.crm_digital_module_for_connection(c.tipo)) and public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'scrittura')));
create policy "digital orders scoped" on public.crm_external_orders for all to authenticated using
 (exists(select 1 from public.crm_external_connections c where c.id=connection_id and public.crm_row_visible(responsabile_id,reparto_id,public.crm_digital_module_for_connection(c.tipo))))
 with check(exists(select 1 from public.crm_external_connections c where c.id=connection_id and public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,public.crm_digital_module_for_connection(c.tipo)) and public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'scrittura')));
create policy "digital order lines through order" on public.crm_external_order_lines for all to authenticated using
 (exists(select 1 from public.crm_external_orders o join public.crm_external_connections c on c.id=o.connection_id where o.id=order_id and public.crm_row_visible(o.responsabile_id,o.reparto_id,public.crm_digital_module_for_connection(c.tipo))))
 with check(exists(select 1 from public.crm_external_orders o join public.crm_external_connections c on c.id=o.connection_id where o.id=order_id and public.crm_row_visible(o.responsabile_id,o.reparto_id,public.crm_digital_module_for_connection(c.tipo)) and public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'scrittura')));
create policy "digital campaigns scoped" on public.crm_external_campaigns for all to authenticated using
 (exists(select 1 from public.crm_external_connections c where c.id=connection_id and public.crm_row_visible(responsabile_id,reparto_id,public.crm_digital_module_for_connection(c.tipo))))
 with check(exists(select 1 from public.crm_external_connections c where c.id=connection_id and public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,public.crm_digital_module_for_connection(c.tipo)) and public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'scrittura')));
create policy "digital metrics scoped" on public.crm_external_metrics for all to authenticated using
 (exists(select 1 from public.crm_external_connections c where c.id=connection_id and public.crm_row_visible(responsabile_id,reparto_id,public.crm_digital_module_for_connection(c.tipo))))
 with check(exists(select 1 from public.crm_external_connections c where c.id=connection_id and public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,public.crm_digital_module_for_connection(c.tipo)) and public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'scrittura')));
create policy "digital sync runs read" on public.crm_sync_runs for select to authenticated using
 (exists(select 1 from public.crm_external_connections c where c.id=connection_id and (public.workspace_user_is_admin() or public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'amministrazione'))));
create policy "digital sync runs admin" on public.crm_sync_runs for all to authenticated using(public.workspace_user_is_admin()) with check(public.workspace_user_is_admin());
create policy "digital consents scoped" on public.crm_marketing_consents for all to authenticated using
 (public.crm_row_visible(responsabile_id,reparto_id,'crm_online')) with check(public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,'crm_online') and public.crm_has_module_level('crm_online','scrittura'));
create policy "digital attribution scoped" on public.crm_attribution_events for all to authenticated using
 (public.crm_row_visible(responsabile_id,reparto_id,'crm_online')) with check(public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,'crm_online') and public.crm_has_module_level('crm_online','scrittura'));
create policy "digital mappings read" on public.crm_product_mappings for select to authenticated using
 (exists(select 1 from public.crm_external_connections c where c.id=connection_id and public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'lettura')));
create policy "digital mappings write" on public.crm_product_mappings for all to authenticated using
 (exists(select 1 from public.crm_external_connections c where c.id=connection_id and public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'scrittura')))
 with check(exists(select 1 from public.crm_external_connections c where c.id=connection_id and public.crm_has_module_level(public.crm_digital_module_for_connection(c.tipo),'scrittura')));

grant select,insert,update,delete on public.crm_external_connections,public.crm_external_accounts,public.crm_external_customers,
 public.crm_external_orders,public.crm_external_order_lines,public.crm_external_campaigns,public.crm_external_metrics,
 public.crm_sync_runs,public.crm_marketing_consents,public.crm_attribution_events,public.crm_product_mappings to authenticated;
grant usage,select on sequence public.crm_external_metrics_id_seq to authenticated;

-- Aggregazione invoker: RLS filtra sempre righe e canali prima del calcolo.
create or replace function public.crm_digital_dashboard(target_from date,target_to date,target_channel text default null,target_marketplace text default null)
returns jsonb language sql stable security invoker set search_path=public as $$
 with orders as (
  select o.* from public.crm_external_orders o join public.crm_external_connections c on c.id=o.connection_id
  where o.ordered_at>=target_from and o.ordered_at<target_to+1
    and (target_channel is null or c.tipo=target_channel) and (target_marketplace is null or o.marketplace=target_marketplace)
 ), metrics as (
  select m.* from public.crm_external_metrics m where m.metric_date between target_from and target_to
    and (target_channel is null or m.channel=target_channel) and (target_marketplace is null or m.marketplace=target_marketplace)
 ) select jsonb_build_object(
  'revenue',case when count(orders.id)=0 then null else sum(orders.net_revenue) end,
  'orders',case when count(orders.id)=0 then null else count(orders.id) end,
  'customers',case when count(orders.account_id)=0 then null else count(distinct orders.account_id) end,
  'aov',case when count(orders.id)=0 then null else sum(orders.net_revenue)/nullif(count(orders.id),0) end,
  'marketingSpend',(select case when count(*)=0 then null else sum(spend) end from metrics),
  'marketingRevenue',(select case when count(*)=0 then null else sum(revenue) end from metrics),
  'roas',(select sum(revenue)/nullif(sum(spend),0) from metrics),
  'dataStatus',case when count(orders.id)=0 and (select count(*) from metrics)=0 then 'not_available' else 'available' end
 ) from orders;
$$;
grant execute on function public.crm_digital_dashboard(date,date,text,text) to authenticated;

-- Lock/idempotenza centralizzati: i worker futuri usano questa RPC prima di leggere un provider.
create or replace function public.crm_claim_sync_run(target_connection_id uuid,target_sync_type text,target_mode text,target_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public as $$
declare run_id uuid; connection_type text;
begin
 select tipo into connection_type from public.crm_external_connections where id=target_connection_id;
 if connection_type is null then raise exception 'Connessione non trovata.'; end if;
 if not public.workspace_user_is_admin() then raise exception 'Operazione riservata all''amministratore Workspace.'; end if;
 insert into public.crm_sync_runs(connection_id,sync_type,mode,status,idempotency_key,started_at,heartbeat_at,triggered_by)
 values(target_connection_id,target_sync_type,coalesce(target_mode,'incremental'),'running',target_idempotency_key,now(),now(),public.workspace_current_profile_id())
 on conflict(connection_id,sync_type,idempotency_key) do update set heartbeat_at=crm_sync_runs.heartbeat_at
 returning id into run_id;
 return run_id;
exception when unique_violation then raise exception 'Sincronizzazione dello stesso tipo già in corso.' using errcode='55P03';
end $$;
revoke all on function public.crm_claim_sync_run(uuid,text,text,text) from public,anon;
grant execute on function public.crm_claim_sync_run(uuid,text,text,text) to authenticated,service_role;

-- Audit delle configurazioni, dei mapping e delle risoluzioni identità.
do $$ declare t text; begin foreach t in array array['crm_external_connections','crm_product_mappings','crm_external_customers'] loop
 execute format('drop trigger if exists %I on public.%I','trg_'||t||'_audit',t);
 execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.crm_audit_row_change()','trg_'||t||'_audit',t);
end loop; end $$;

commit;

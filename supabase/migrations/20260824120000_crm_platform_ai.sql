begin;

-- CRM Platform AI: estensione nativa del catalogo e del modello autorizzativo Workspace.
insert into public.workspace_aree (codice,nome,descrizione,ordine,attiva)
values ('crm','CRM','Relazioni commerciali, campagne e assistenza strategica AI.',65,true)
on conflict (codice) do update set nome=excluded.nome,descrizione=excluded.descrizione,attiva=true;

insert into public.workspace_reparti_aree (reparto_id,area_codice)
select id,'crm' from public.reparti on conflict do nothing;
insert into public.workspace_ruoli_aree (ruolo_id,area_codice)
select id,'crm' from public.ruoli on conflict do nothing;

alter table public.workspace_moduli add column if not exists dipendenze_alternative text[] not null default '{}';
comment on column public.workspace_moduli.dipendenze_alternative is
  'Il contenitore e accessibile quando almeno uno dei moduli elencati e autorizzato.';

insert into public.workspace_moduli
  (codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,
   assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,icona,dipendenze_alternative)
values
  ('crm','CRM Platform AI','Panoramica delle aree CRM autorizzate.','contenitore','crm','/crm','workspace',false,false,false,true,true,65,'briefcase',array['crm_conto_terzi','crm_b2b','crm_online','crm_ai']),
  ('crm_conto_terzi','CRM Conto Terzi','Clienti, brief e opportunita conto terzi.','contenitore','crm','/crm/conto-terzi','workspace',false,true,true,false,true,66,'handshake','{}'),
  ('crm_b2b','CRM B2B','Clienti professionali e dati commerciali collegati a Mexal.','contenitore','crm','/crm/b2b','workspace',false,true,true,false,true,67,'store','{}'),
  ('crm_online','CRM Online','Clienti ecommerce, campagne, creator e customer journey.','contenitore','crm','/crm/online','workspace',false,true,true,false,true,68,'shopping-bag','{}'),
  ('crm_ai','AI Business Assistant','Brief strategici, decisioni e piani operativi controllati.','modulo','crm','/crm/ai','workspace',false,true,true,false,true,69,'bot','{}')
on conflict (codice) do update set
  nome=excluded.nome,descrizione=excluded.descrizione,tipo=excluded.tipo,area=excluded.area,
  percorso=excluded.percorso,provider='workspace',assegnabile_reparto=excluded.assegnabile_reparto,
  configurabile_ruolo=excluded.configurabile_ruolo,mostra_menu=excluded.mostra_menu,
  attivo=true,ordine=excluded.ordine,icona=excluded.icona,
  dipendenze_alternative=excluded.dipendenze_alternative;

insert into public.ruoli_moduli (ruolo_id,modulo,livello_accesso)
select r.id,m.codice,case when r.amministratore_workspace then 'amministrazione' else coalesce(r.livello_accesso,'lettura') end
from public.ruoli r cross join public.workspace_moduli m
where m.codice in ('crm_conto_terzi','crm_b2b','crm_online','crm_ai')
on conflict (ruolo_id,modulo) do nothing;

insert into public.workspace_menu_voci (codice,nome,descrizione,icona,ordine,attiva)
values ('crm','CRM','CRM Platform AI','briefcase',65,true)
on conflict (codice) do update set nome=excluded.nome,descrizione=excluded.descrizione,
  icona=excluded.icona,ordine=excluded.ordine,attiva=true;
insert into public.workspace_menu_moduli (voce_codice,modulo_codice,ordine)
values ('crm','crm',10) on conflict (voce_codice,modulo_codice) do update set ordine=10;

insert into public.workspace_schermate
  (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,icona,metadati,ultima_sincronizzazione)
values
 ('crm.dashboard','Panoramica CRM','Accesso alle sole aree CRM autorizzate.','workspace','/crm','crm.overview',false,true,10,'crm','briefcase','{}',now()),
 ('crm.conto_terzi.dashboard','Dashboard Conto Terzi','Pipeline, brief e attivita conto terzi.','workspace','/crm/conto-terzi','crm.dashboard',false,true,20,'crm','chart','{}',now()),
 ('crm.conto_terzi.clienti','Clienti Conto Terzi','Clienti, prospect e relazione commerciale.','workspace','/crm/conto-terzi/clienti','crm.accounts',false,true,21,'crm','users','{}',now()),
 ('crm.conto_terzi.cliente','Scheda Cliente Conto Terzi','Dettaglio cliente, collegamenti e timeline.','workspace','/crm/conto-terzi/clienti/:id','crm.account',false,true,22,'crm','briefcase','{}',now()),
 ('crm.conto_terzi.pipeline','Pipeline Conto Terzi','Opportunita in Kanban configurabile.','workspace','/crm/conto-terzi/pipeline','crm.pipeline',false,true,23,'crm','workflow','{}',now()),
 ('crm.conto_terzi.brief','Brief Cliente','Brief prodotto collegati a cliente e opportunita.','workspace','/crm/conto-terzi/brief','crm.briefs',false,true,24,'crm','clipboard','{}',now()),
 ('crm.b2b.dashboard','Dashboard B2B','Clienti, ordini, fatture e follow-up B2B.','workspace','/crm/b2b','crm.dashboard',false,true,30,'crm','chart','{}',now()),
 ('crm.b2b.clienti','Clienti B2B','Clienti professionali collegabili a Mexal.','workspace','/crm/b2b/clienti','crm.accounts',false,true,31,'crm','store','{}',now()),
 ('crm.b2b.cliente','Scheda Cliente B2B','Relazione CRM e dati Mexal autorizzati.','workspace','/crm/b2b/clienti/:id','crm.account',false,true,32,'crm','briefcase','{}',now()),
 ('crm.b2b.pipeline','Pipeline B2B','Opportunita commerciali B2B.','workspace','/crm/b2b/pipeline','crm.pipeline',false,true,33,'crm','workflow','{}',now()),
 ('crm.online.dashboard','Dashboard Online','KPI digitali disponibili e fonti mancanti.','workspace','/crm/online','crm.dashboard',false,true,40,'crm','chart','{}',now()),
 ('crm.online.clienti','Clienti Online','Clienti ecommerce, consensi e segmenti.','workspace','/crm/online/clienti','crm.accounts',false,true,41,'crm','users','{}',now()),
 ('crm.online.campaigns','Campaign Manager','Pianificazione e KPI delle campagne.','workspace','/crm/online/campagne','crm.campaigns',false,true,42,'crm','calendar','{}',now()),
 ('crm.online.creators','Creator Management','Collaborazioni, contenuti e ROI creator.','workspace','/crm/online/creator','crm.creators',false,true,43,'crm','sparkles','{}',now()),
 ('crm.online.customer_journey','Customer Journey','Eventi autorizzati del percorso cliente.','workspace','/crm/online/customer-journey','crm.journey',false,true,44,'crm','workflow','{}',now()),
 ('crm.ai','AI Business Assistant','Brief strategico, preview, decisione umana e creazione progetto.','workspace','/crm/ai','crm.ai',false,true,50,'crm','bot','{}',now())
on conflict (codice) do update set nome=excluded.nome,descrizione=excluded.descrizione,
  percorso=excluded.percorso,chiave_componente=excluded.chiave_componente,attiva=true,
  area='crm',icona=excluded.icona,ultima_sincronizzazione=now();

insert into public.workspace_moduli_schermate (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values
 ('crm','crm.dashboard',10,true,true),
 ('crm_conto_terzi','crm.conto_terzi.dashboard',10,true,true),
 ('crm_conto_terzi','crm.conto_terzi.clienti',20,false,true),
 ('crm_conto_terzi','crm.conto_terzi.cliente',21,false,false),
 ('crm_conto_terzi','crm.conto_terzi.pipeline',30,false,true),
 ('crm_conto_terzi','crm.conto_terzi.brief',40,false,true),
 ('crm_b2b','crm.b2b.dashboard',10,true,true),('crm_b2b','crm.b2b.clienti',20,false,true),
 ('crm_b2b','crm.b2b.cliente',21,false,false),('crm_b2b','crm.b2b.pipeline',30,false,true),
 ('crm_online','crm.online.dashboard',10,true,true),('crm_online','crm.online.clienti',20,false,true),
 ('crm_online','crm.online.campaigns',30,false,true),('crm_online','crm.online.creators',40,false,true),
 ('crm_online','crm.online.customer_journey',50,false,true),('crm_ai','crm.ai',10,true,true)
on conflict (modulo_codice,schermata_codice) do update set ordine=excluded.ordine,
  predefinita=excluded.predefinita,visibile_menu=excluded.visibile_menu;

create table if not exists public.crm_accounts (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('conto_terzi','b2b','online')),
  nome text not null,
  stato text not null default 'prospect',
  stato_relazione text,
  valore_cliente numeric(14,2),
  responsabile_id uuid references public.utenti(id) on delete set null,
  reparto_id uuid references public.reparti(id) on delete set null,
  codice_cliente_mexal text,
  fonte text not null default 'workspace',
  partita_iva text,codice_fiscale text,email text,telefono text,
  indirizzo text,citta text,provincia text,cap text,paese text,
  agente_id uuid references public.mexal_agenti(id) on delete set null,
  segmenti text[] not null default '{}',consensi jsonb not null default '{}',
  metadati jsonb not null default '{}',ultima_attivita_il timestamptz,prossima_attivita_il timestamptz,
  creato_da uuid references public.utenti(id) on delete set null,
  creato_il timestamptz not null default now(),aggiornato_il timestamptz not null default now()
);
create unique index if not exists crm_accounts_mexal_unique on public.crm_accounts(tipo,codice_cliente_mexal)
  where codice_cliente_mexal is not null;
create index if not exists crm_accounts_scope_idx on public.crm_accounts(tipo,reparto_id,responsabile_id,stato);
create index if not exists crm_accounts_search_idx on public.crm_accounts using gin
  (to_tsvector('simple',coalesce(nome,'')||' '||coalesce(codice_cliente_mexal,'')||' '||coalesce(email,'')));

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),account_id uuid not null references public.crm_accounts(id) on delete cascade,
  nome text not null,cognome text,ruolo text,email text,telefono text,principale boolean not null default false,
  consensi jsonb not null default '{}',note text,creato_da uuid references public.utenti(id) on delete set null,
  creato_il timestamptz not null default now(),aggiornato_il timestamptz not null default now()
);
create index if not exists crm_contacts_account_idx on public.crm_contacts(account_id);

create table if not exists public.crm_opportunity_stages (
  id uuid primary key default gen_random_uuid(),crm_tipo text not null check (crm_tipo in ('conto_terzi','b2b','online')),
  codice text not null,nome text not null,ordine integer not null default 0,colore text,
  finale boolean not null default false,vinta boolean not null default false,attiva boolean not null default true,
  creato_il timestamptz not null default now(),aggiornato_il timestamptz not null default now(),unique(crm_tipo,codice)
);
insert into public.crm_opportunity_stages (crm_tipo,codice,nome,ordine,finale,vinta)
select tipo,codice,nome,ordine,finale,vinta from (values
 ('nuovo_contatto','Nuovo contatto',10,false,false),('qualificazione','Qualificazione',20,false,false),
 ('brief','Brief',30,false,false),('campionatura','Campionatura',40,false,false),('offerta','Offerta',50,false,false),
 ('negoziazione','Negoziazione',60,false,false),('approvazione','Approvazione',70,false,false),
 ('industrializzazione','Industrializzazione',80,false,false),('cliente_attivo','Cliente attivo',90,false,false),
 ('vinto','Vinto',100,true,true),('perso','Perso',110,true,false)
) as stage(codice,nome,ordine,finale,vinta)
cross join (values ('conto_terzi'),('b2b')) as kinds(tipo)
on conflict (crm_tipo,codice) do nothing;

create table if not exists public.crm_opportunities (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.crm_accounts(id) on delete cascade,
 titolo text not null,stage_id uuid references public.crm_opportunity_stages(id) on delete set null,
 valore numeric(14,2),probabilita integer check (probabilita between 0 and 100),chiusura_prevista date,
 responsabile_id uuid references public.utenti(id) on delete set null,reparto_id uuid references public.reparti(id) on delete set null,
 origine text,descrizione text,motivo_perdita text,creato_da uuid references public.utenti(id) on delete set null,
 creato_il timestamptz not null default now(),aggiornato_il timestamptz not null default now()
);
create index if not exists crm_opportunities_pipeline_idx on public.crm_opportunities(stage_id,reparto_id,responsabile_id,chiusura_prevista);

create table if not exists public.crm_activities (
 id uuid primary key default gen_random_uuid(),crm_tipo text not null check (crm_tipo in ('conto_terzi','b2b','online')),
 account_id uuid references public.crm_accounts(id) on delete cascade,opportunity_id uuid references public.crm_opportunities(id) on delete cascade,
 tipo text not null,titolo text not null,descrizione text,stato text not null default 'pianificata',
 data_attivita timestamptz,completata_il timestamptz,responsabile_id uuid references public.utenti(id) on delete set null,
 reparto_id uuid references public.reparti(id) on delete set null,reminder_id uuid,
 creato_da uuid references public.utenti(id) on delete set null,creato_il timestamptz not null default now(),aggiornato_il timestamptz not null default now()
);
create index if not exists crm_activities_deadline_idx on public.crm_activities(stato,data_attivita,reparto_id,responsabile_id);

create table if not exists public.crm_briefs (
 id uuid primary key default gen_random_uuid(),crm_tipo text not null check (crm_tipo in ('conto_terzi','b2b','online')),
 titolo text not null,stato text not null default 'bozza' check (stato in ('bozza','in_analisi','decisione_proposta','approvato','trasformato_in_progetto','archiviato')),
 account_id uuid references public.crm_accounts(id) on delete set null,opportunity_id uuid references public.crm_opportunities(id) on delete set null,
 campaign_id uuid,responsabile_id uuid references public.utenti(id) on delete set null,reparto_id uuid references public.reparti(id) on delete set null,
 obiettivo text,brand text,categoria text,tipo_prodotto text,target text,posizionamento text,
 prezzo_target numeric(14,2),quantita numeric(14,3),packaging text,claim text,mercati text[],certificazioni text[],
 tempistiche text,note text,dati jsonb not null default '{}',piano_corrente jsonb,
 creato_da uuid references public.utenti(id) on delete set null,creato_il timestamptz not null default now(),aggiornato_il timestamptz not null default now()
);
create index if not exists crm_briefs_scope_idx on public.crm_briefs(crm_tipo,reparto_id,responsabile_id,stato);

create table if not exists public.crm_brief_messages (
 id uuid primary key default gen_random_uuid(),brief_id uuid not null references public.crm_briefs(id) on delete cascade,
 ruolo text not null check (ruolo in ('user','assistant','system')),contenuto text not null,metadati jsonb not null default '{}',
 creato_da uuid references public.utenti(id) on delete set null,creato_il timestamptz not null default now()
);
create index if not exists crm_brief_messages_idx on public.crm_brief_messages(brief_id,creato_il);

create table if not exists public.crm_ai_decisions (
 id uuid primary key default gen_random_uuid(),brief_id uuid not null references public.crm_briefs(id) on delete cascade,
 versione integer not null default 1,titolo text not null,riepilogo text,piano jsonb not null,
 stato text not null default 'proposta' check (stato in ('proposta','approvata','rifiutata','applicata','errore')),
 approvata_da uuid references public.utenti(id) on delete set null,approvata_il timestamptz,progetto_id uuid,errore text,
 creata_da uuid references public.utenti(id) on delete set null,creata_il timestamptz not null default now(),aggiornata_il timestamptz not null default now()
);
create index if not exists crm_ai_decisions_brief_idx on public.crm_ai_decisions(brief_id,versione desc);

create table if not exists public.crm_campaigns (
 id uuid primary key default gen_random_uuid(),nome text not null,obiettivo text,canale text,target text,
 budget numeric(14,2),data_inizio date,data_fine date,responsabile_id uuid references public.utenti(id) on delete set null,
 reparto_id uuid references public.reparti(id) on delete set null,stato text not null default 'bozza',
 prodotti uuid[] not null default '{}',contenuti jsonb not null default '[]',kpi_target jsonb not null default '{}',kpi_effettivi jsonb not null default '{}',
 creato_da uuid references public.utenti(id) on delete set null,creato_il timestamptz not null default now(),aggiornato_il timestamptz not null default now()
);
alter table public.crm_briefs drop constraint if exists crm_briefs_campaign_id_fkey;
alter table public.crm_briefs add constraint crm_briefs_campaign_id_fkey foreign key (campaign_id) references public.crm_campaigns(id) on delete set null;
create index if not exists crm_campaigns_scope_idx on public.crm_campaigns(reparto_id,responsabile_id,stato,data_fine);

create table if not exists public.crm_creators (
 id uuid primary key default gen_random_uuid(),nome text not null,profilo text,piattaforma text,nicchia text,email text,telefono text,
 follower integer,metriche jsonb not null default '{}',stato_collaborazione text not null default 'prospect',
 prodotti_inviati uuid[] not null default '{}',costi numeric(14,2),vendite_attribuite numeric(14,2),note text,
 responsabile_id uuid references public.utenti(id) on delete set null,reparto_id uuid references public.reparti(id) on delete set null,
 creato_da uuid references public.utenti(id) on delete set null,creato_il timestamptz not null default now(),aggiornato_il timestamptz not null default now()
);
create table if not exists public.crm_creator_contents (
 id uuid primary key default gen_random_uuid(),creator_id uuid not null references public.crm_creators(id) on delete cascade,
 campaign_id uuid references public.crm_campaigns(id) on delete set null,titolo text not null,tipo text,stato text not null default 'richiesto',
 url text,data_richiesta date,data_ricezione date,metriche jsonb not null default '{}',note text,
 creato_il timestamptz not null default now(),aggiornato_il timestamptz not null default now()
);
create table if not exists public.crm_customer_events (
 id uuid primary key default gen_random_uuid(),account_id uuid references public.crm_accounts(id) on delete cascade,
 fase text not null check (fase in ('lead','visita','interesse','iscrizione','carrello','acquisto','riacquisto','recensione','loyalty')),
 avvenuto_il timestamptz not null default now(),fonte text,consenso_riferimento text,dati jsonb not null default '{}',
 creato_da uuid references public.utenti(id) on delete set null,creato_il timestamptz not null default now()
);
create index if not exists crm_customer_events_account_idx on public.crm_customer_events(account_id,avvenuto_il desc);

create table if not exists public.crm_tags (id uuid primary key default gen_random_uuid(),nome text not null unique,colore text,creato_il timestamptz not null default now());
create table if not exists public.crm_entity_tags (
 tag_id uuid not null references public.crm_tags(id) on delete cascade,entity_type text not null,entity_id uuid not null,
 primary key(tag_id,entity_type,entity_id)
);
create table if not exists public.crm_workspace_links (
 id uuid primary key default gen_random_uuid(),crm_entity_type text not null,crm_entity_id uuid not null,
 workspace_entity_type text not null,workspace_entity_id uuid not null,metadati jsonb not null default '{}',
 creato_da uuid references public.utenti(id) on delete set null,creato_il timestamptz not null default now(),
 unique(crm_entity_type,crm_entity_id,workspace_entity_type,workspace_entity_id)
);
create index if not exists crm_workspace_links_reverse_idx on public.crm_workspace_links(workspace_entity_type,workspace_entity_id);
create table if not exists public.crm_audit_log (
 id bigint generated by default as identity primary key,utente_id uuid references public.utenti(id) on delete set null,
 entita_tipo text not null,entita_id uuid,operazione text not null,dettagli jsonb not null default '{}',creato_il timestamptz not null default now()
);
create index if not exists crm_audit_entity_idx on public.crm_audit_log(entita_tipo,entita_id,creato_il desc);

create or replace function public.crm_module_for_type(target_type text)
returns text language sql immutable as $$ select case target_type when 'conto_terzi' then 'crm_conto_terzi' when 'b2b' then 'crm_b2b' when 'online' then 'crm_online' else null end $$;

create or replace function public.crm_has_module_level(target_module text,required_level text default 'lettura')
returns boolean language sql stable security definer set search_path=public as $$
 with me as (
   select u.id,u.ruolo_id,coalesce(r.amministratore_workspace,false) admin,coalesce(r.livello_accesso,'lettura') base_level
   from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
   where u.auth_user_id=auth.uid() and u.attivo is not false limit 1
 ), effective as (
   select me.admin,coalesce(e.livello_accesso,rm.livello_accesso,me.base_level,'lettura') level
   from me left join public.ruoli_moduli rm on rm.ruolo_id=me.ruolo_id and rm.modulo=target_module
   left join public.workspace_eccezioni_utente e on e.utente_id=me.id and e.ambito='modulo' and e.codice=target_module
     and e.decisione='consenti' and (e.valida_fino_a is null or e.valida_fino_a>now())
 )
 select coalesce((select e.admin or (public.workspace_module_enabled_for_user(me.id,target_module) and
   case e.level when 'amministrazione' then 3 when 'scrittura' then 2 else 1 end >=
   case required_level when 'amministrazione' then 3 when 'scrittura' then 2 else 1 end) from me cross join effective e),false)
$$;
revoke all on function public.crm_has_module_level(text,text) from public,anon;
grant execute on function public.crm_has_module_level(text,text) to authenticated,service_role;

create or replace function public.crm_row_visible(owner_id uuid,department_id uuid,target_module text)
returns boolean language sql stable security definer set search_path=public as $$
 with me as (
  select u.id,coalesce(r.amministratore_workspace,false) admin,coalesce(r.ambito_dati,'propri') scope
  from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
  where u.auth_user_id=auth.uid() and u.attivo is not false limit 1
 )
 select coalesce((select public.crm_has_module_level(target_module,'lettura') and (
   admin or scope='tutti' or owner_id=me.id or (scope='team' and department_id is not null and exists(
     select 1 from public.utenti_reparti ur where ur.utente_id=me.id and ur.reparto_id=department_id
     union select 1 from public.utenti u where u.id=me.id and u.reparto_id=department_id
   ))) from me),false)
$$;
revoke all on function public.crm_row_visible(uuid,uuid,text) from public,anon;
grant execute on function public.crm_row_visible(uuid,uuid,text) to authenticated,service_role;

create or replace function public.crm_set_updated_at() returns trigger language plpgsql as $$ begin new.aggiornato_il=now(); return new; end $$;
do $$ declare t text; begin foreach t in array array['crm_accounts','crm_contacts','crm_opportunity_stages','crm_opportunities','crm_activities','crm_briefs','crm_ai_decisions','crm_campaigns','crm_creators','crm_creator_contents'] loop
 execute format('drop trigger if exists %I on public.%I','trg_'||t||'_updated',t);
 execute format('create trigger %I before update on public.%I for each row execute function public.crm_set_updated_at()','trg_'||t||'_updated',t);
end loop; end $$;

do $$ declare t text; begin foreach t in array array['crm_accounts','crm_contacts','crm_opportunity_stages','crm_opportunities','crm_activities','crm_briefs','crm_brief_messages','crm_ai_decisions','crm_campaigns','crm_creators','crm_creator_contents','crm_customer_events','crm_tags','crm_entity_tags','crm_workspace_links','crm_audit_log'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;

create policy "crm accounts scoped read" on public.crm_accounts for select to authenticated using (public.crm_row_visible(responsabile_id,reparto_id,public.crm_module_for_type(tipo)));
create policy "crm accounts scoped write" on public.crm_accounts for all to authenticated using (public.crm_row_visible(responsabile_id,reparto_id,public.crm_module_for_type(tipo)) and public.crm_has_module_level(public.crm_module_for_type(tipo),'scrittura')) with check (public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,public.crm_module_for_type(tipo)) and public.crm_has_module_level(public.crm_module_for_type(tipo),'scrittura'));
create policy "crm stages read" on public.crm_opportunity_stages for select to authenticated using (public.crm_has_module_level(public.crm_module_for_type(crm_tipo),'lettura'));
create policy "crm stages admin" on public.crm_opportunity_stages for all to authenticated using (public.crm_has_module_level(public.crm_module_for_type(crm_tipo),'amministrazione')) with check (public.crm_has_module_level(public.crm_module_for_type(crm_tipo),'amministrazione'));
create policy "crm contacts through account" on public.crm_contacts for all to authenticated using (exists(select 1 from public.crm_accounts a where a.id=account_id and public.crm_row_visible(a.responsabile_id,a.reparto_id,public.crm_module_for_type(a.tipo)))) with check (exists(select 1 from public.crm_accounts a where a.id=account_id and public.crm_row_visible(a.responsabile_id,a.reparto_id,public.crm_module_for_type(a.tipo)) and public.crm_has_module_level(public.crm_module_for_type(a.tipo),'scrittura')));
create policy "crm opportunities through account" on public.crm_opportunities for all to authenticated using (exists(select 1 from public.crm_accounts a where a.id=account_id and public.crm_row_visible(coalesce(responsabile_id,a.responsabile_id),coalesce(reparto_id,a.reparto_id),public.crm_module_for_type(a.tipo)))) with check (exists(select 1 from public.crm_accounts a where a.id=account_id and public.crm_has_module_level(public.crm_module_for_type(a.tipo),'scrittura') and public.crm_row_visible(coalesce(responsabile_id,a.responsabile_id),coalesce(reparto_id,a.reparto_id),public.crm_module_for_type(a.tipo))));
create policy "crm activities scoped" on public.crm_activities for all to authenticated using (public.crm_row_visible(responsabile_id,reparto_id,public.crm_module_for_type(crm_tipo))) with check (public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,public.crm_module_for_type(crm_tipo)) and public.crm_has_module_level(public.crm_module_for_type(crm_tipo),'scrittura'));
create policy "crm briefs scoped" on public.crm_briefs for all to authenticated using (public.crm_row_visible(responsabile_id,reparto_id,public.crm_module_for_type(crm_tipo))) with check (public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,public.crm_module_for_type(crm_tipo)) and public.crm_has_module_level(public.crm_module_for_type(crm_tipo),'scrittura'));
create policy "crm brief messages scoped" on public.crm_brief_messages for all to authenticated using (exists(select 1 from public.crm_briefs b where b.id=brief_id and public.crm_row_visible(b.responsabile_id,b.reparto_id,public.crm_module_for_type(b.crm_tipo)))) with check (exists(select 1 from public.crm_briefs b where b.id=brief_id and public.crm_has_module_level('crm_ai','scrittura') and public.crm_row_visible(b.responsabile_id,b.reparto_id,public.crm_module_for_type(b.crm_tipo))));
create policy "crm decisions scoped" on public.crm_ai_decisions for all to authenticated using (exists(select 1 from public.crm_briefs b where b.id=brief_id and public.crm_row_visible(b.responsabile_id,b.reparto_id,public.crm_module_for_type(b.crm_tipo)))) with check (exists(select 1 from public.crm_briefs b where b.id=brief_id and public.crm_has_module_level('crm_ai','scrittura') and public.crm_row_visible(b.responsabile_id,b.reparto_id,public.crm_module_for_type(b.crm_tipo))));
create policy "crm campaigns scoped" on public.crm_campaigns for all to authenticated using (public.crm_row_visible(responsabile_id,reparto_id,'crm_online')) with check (public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,'crm_online') and public.crm_has_module_level('crm_online','scrittura'));
create policy "crm creators scoped" on public.crm_creators for all to authenticated using (public.crm_row_visible(responsabile_id,reparto_id,'crm_online')) with check (public.crm_row_visible(coalesce(responsabile_id,public.workspace_current_profile_id()),reparto_id,'crm_online') and public.crm_has_module_level('crm_online','scrittura'));
create policy "crm creator contents scoped" on public.crm_creator_contents for all to authenticated using (exists(select 1 from public.crm_creators c where c.id=creator_id and public.crm_row_visible(c.responsabile_id,c.reparto_id,'crm_online'))) with check (exists(select 1 from public.crm_creators c where c.id=creator_id and public.crm_row_visible(c.responsabile_id,c.reparto_id,'crm_online') and public.crm_has_module_level('crm_online','scrittura')));
create policy "crm customer events scoped" on public.crm_customer_events for all to authenticated using (exists(select 1 from public.crm_accounts a where a.id=account_id and a.tipo='online' and public.crm_row_visible(a.responsabile_id,a.reparto_id,'crm_online'))) with check (exists(select 1 from public.crm_accounts a where a.id=account_id and a.tipo='online' and public.crm_row_visible(a.responsabile_id,a.reparto_id,'crm_online') and public.crm_has_module_level('crm_online','scrittura')));
create policy "crm support read" on public.crm_tags for select to authenticated using (public.crm_has_module_level('crm','lettura'));
create policy "crm support admin" on public.crm_tags for all to authenticated using (public.workspace_user_is_admin()) with check (public.workspace_user_is_admin());
create policy "crm entity tags" on public.crm_entity_tags for all to authenticated using (public.crm_has_module_level('crm','lettura')) with check (public.crm_has_module_level('crm','scrittura'));
create policy "crm links read" on public.crm_workspace_links for select to authenticated using (public.crm_has_module_level('crm','lettura'));
create policy "crm links write" on public.crm_workspace_links for all to authenticated using (public.crm_has_module_level('crm_ai','scrittura')) with check (public.crm_has_module_level('crm_ai','scrittura'));
create policy "crm audit read" on public.crm_audit_log for select to authenticated using (public.crm_has_module_level('crm','amministrazione') or utente_id=public.workspace_current_profile_id());
create policy "crm audit insert" on public.crm_audit_log for insert to authenticated with check (utente_id=public.workspace_current_profile_id());

grant select,insert,update,delete on public.crm_accounts,public.crm_contacts,public.crm_opportunity_stages,
 public.crm_opportunities,public.crm_activities,public.crm_briefs,public.crm_brief_messages,public.crm_ai_decisions,
 public.crm_campaigns,public.crm_creators,public.crm_creator_contents,public.crm_customer_events,public.crm_tags,
 public.crm_entity_tags,public.crm_workspace_links,public.crm_audit_log to authenticated;
grant usage,select on sequence public.crm_audit_log_id_seq to authenticated;

-- Il contenitore CRM eredita l'accesso da almeno una sua area, senza ruoli hardcoded.
create or replace function public.workspace_module_enabled_for_user(target_user_id uuid,target_module text)
returns boolean language sql stable security definer set search_path=public as $$
 with target as (
  select u.id,u.reparto_id,u.auth_user_id,coalesce(r.amministratore_workspace,false) is_admin,
    coalesce(r.livello_ai,'analisi') role_ai_level
  from public.utenti u left join public.ruoli r on r.id=u.ruolo_id
  where u.id=target_user_id and u.attivo is not false limit 1
 ), exception as (
  select e.decisione from target t join public.workspace_eccezioni_utente e on e.utente_id=t.id
  where e.ambito='modulo' and e.codice=target_module and (e.valida_fino_a is null or e.valida_fino_a>now()) limit 1
 ), departments as (
  select ur.reparto_id from public.utenti_reparti ur join target t on t.id=ur.utente_id where ur.reparto_id is not null
  union select t.reparto_id from target t where t.reparto_id is not null
 )
 select coalesce((select case
  when t.is_admin then true
  when target_module in ('assistente_ai','crm_ai') and t.role_ai_level='nessuno' then false
  when (select decisione from exception)='consenti' then true
  when (select decisione from exception)='nega' then false
  when not m.attivo then false
  when m.area is not null and not (m.area=any(public.workspace_area_access_codes(t.auth_user_id))) then false
  when m.sempre_disponibile then true
  when cardinality(coalesce(m.dipendenze_alternative,'{}'))>0 then exists(
    select 1 from unnest(m.dipendenze_alternative) d(code)
    where public.workspace_module_enabled_for_user(target_user_id,d.code))
  when m.assegnabile_reparto then exists(select 1 from departments d join public.reparti_moduli rm on rm.reparto_id=d.reparto_id where rm.modulo=target_module)
  when m.provider='progremes' and target_module<>'progremes' then exists(
    select 1 from departments d join public.reparti_moduli ma on ma.reparto_id=d.reparto_id and ma.modulo='progremes'
    join public.progremes_reparti_moduli prm on prm.reparto_id=d.reparto_id
    join public.progremes_moduli pm on pm.codice=prm.modulo_codice and pm.attivo
    where public.workspace_progremes_module_code(prm.modulo_codice)=target_module)
  when cardinality(coalesce(m.dipendenze,'{}'))>0 then not exists(
    select 1 from unnest(m.dipendenze) d(code) where not public.workspace_module_enabled_for_user(target_user_id,d.code))
  else false end from target t join public.workspace_moduli m on m.codice=target_module),false)
$$;
revoke all on function public.workspace_module_enabled_for_user(uuid,text) from public,anon;
grant execute on function public.workspace_module_enabled_for_user(uuid,text) to authenticated,service_role;

commit;

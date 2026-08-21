begin;

alter table public.workspace_moduli
  add column if not exists descrizione text,
  add column if not exists protetto boolean not null default false,
  add column if not exists configurabile_ruolo boolean not null default true,
  add column if not exists mostra_menu boolean not null default true,
  add column if not exists aggiornato_il timestamptz not null default now();

update public.workspace_moduli
set protetto = codice in ('home','attivita','prodotti','documenti','messaggi','notifiche'),
    configurabile_ruolo = codice not in ('home','notifiche','analisi_dati','analisi_attivita','analisi_fatture','analisi_ordini_ph','analisi_beauty_days'),
    mostra_menu = codice not in ('analisi_attivita','analisi_fatture','analisi_ordini_ph','analisi_beauty_days');

insert into public.workspace_moduli
  (codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine)
values
  ('agenda','Agenda (legacy)','Compatibilità con le assegnazioni storiche dei reparti.','vista_derivata','operativita','/agenda','workspace',false,true,true,false,true,24),
  ('progetti','Progetti (legacy)','Compatibilità con le assegnazioni storiche dei reparti.','vista_derivata','operativita','/activities/projects','workspace',false,true,true,false,true,25),
  ('report','Report (legacy)','Compatibilità con le assegnazioni storiche dei reparti.','vista_derivata','analisi','/analisi-dati/attivita','workspace',false,true,true,false,true,26)
on conflict (codice) do nothing;

grant select on public.workspace_moduli to authenticated;

create table if not exists public.workspace_schermate (
  codice text primary key,
  nome text not null,
  descrizione text,
  provider text not null default 'workspace' check (provider in ('workspace','progremes')),
  percorso text not null,
  chiave_componente text,
  protetta boolean not null default false,
  attiva boolean not null default true,
  ordine integer not null default 0,
  metadati jsonb not null default '{}'::jsonb,
  prima_sincronizzazione timestamptz not null default now(),
  ultima_sincronizzazione timestamptz not null default now()
);

create table if not exists public.workspace_moduli_schermate (
  modulo_codice text not null references public.workspace_moduli(codice) on update cascade on delete cascade,
  schermata_codice text not null references public.workspace_schermate(codice) on update cascade on delete cascade,
  ordine integer not null default 0,
  predefinita boolean not null default false,
  visibile_menu boolean not null default true,
  primary key (modulo_codice, schermata_codice)
);

insert into public.workspace_schermate
  (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,ordine)
values
  ('home','Home','Pagina iniziale del Workspace.','workspace','/home','home',true,10),
  ('attivita.dashboard','Panoramica attività','Attività e scadenze del reparto.','workspace','/activities/dashboard','activities.dashboard',true,20),
  ('attivita.reminder','Reminder','Reminder personali e del reparto.','workspace','/activities/reminders','activities.reminders',true,30),
  ('attivita.progetti','Progetti','Progetti, checklist e fasi.','workspace','/activities/projects','activities.projects',true,40),
  ('attivita.fasi','Fasi dei progetti','Planning delle fasi progettuali.','workspace','/activities/tasks','activities.tasks',true,50),
  ('prodotti','Prodotti','Catalogo prodotti Workspace.','workspace','/products','products',true,60),
  ('documenti','Documenti','Archivio documentale Workspace.','workspace','/documentation','documentation',true,70),
  ('messaggi','Messaggi','Chat e messaggi interni.','workspace','/messages','messages',true,80),
  ('notifiche','Notifiche','Centro notifiche personale.','workspace','/notifications','notifications',true,90),
  ('team','Team','Componenti dei reparti autorizzati.','workspace','/team','team',false,100),
  ('beauty.dashboard','Beauty Days','Gestione giornate promozionali.','workspace','/farmacie/dashboard','beauty.dashboard',false,110),
  ('ordini_pr.dashboard','Ordini PR','Dashboard Ordini PR.','workspace','/ordini-prof','orders.pr',false,120),
  ('ordini_ph.dashboard','Ordini PH','Dashboard Ordini PH.','workspace','/ordini-ph','orders.ph',false,130),
  ('analisi.attivita','Analisi attività','Analisi su attività e progetti.','workspace','/analisi-dati/attivita','analytics.activities',false,140),
  ('analisi.fatture','Analisi fatture','Analisi fatture dipendente da Ordini PR.','workspace','/analisi-dati/fatture','analytics.invoices',false,150),
  ('analisi.ordini_ph','Analisi Ordini PH','Analisi ordini farmacia.','workspace','/analisi-dati/ordini-ph','analytics.orders_ph',false,160),
  ('analisi.beauty_days','Analisi Beauty Days','Analisi giornate promozionali.','workspace','/analisi-dati/beauty-days','analytics.beauty',false,170),
  ('integrazioni','Integrazioni','Centro servizi e sincronizzazioni.','workspace','/integrations','integrations',false,900),
  ('impostazioni','Impostazioni','Amministrazione del Workspace.','workspace','/settings','settings',false,910)
on conflict (codice) do update set
  nome=excluded.nome, descrizione=excluded.descrizione, percorso=excluded.percorso,
  chiave_componente=excluded.chiave_componente, protetta=excluded.protetta, ordine=excluded.ordine;

insert into public.workspace_moduli_schermate (modulo_codice,schermata_codice,ordine,predefinita)
values
  ('home','home',10,true),
  ('attivita','attivita.dashboard',10,true),
  ('attivita','attivita.reminder',20,false),
  ('attivita','attivita.progetti',30,false),
  ('attivita','attivita.fasi',40,false),
  ('prodotti','prodotti',10,true),
  ('documenti','documenti',10,true),
  ('messaggi','messaggi',10,true),
  ('notifiche','notifiche',10,true),
  ('team','team',10,true),
  ('beauty_days','beauty.dashboard',10,true),
  ('ordini_pr','ordini_pr.dashboard',10,true),
  ('ordini_ph','ordini_ph.dashboard',10,true),
  ('analisi_dati','analisi.attivita',10,true),
  ('analisi_dati','analisi.fatture',20,false),
  ('analisi_dati','analisi.ordini_ph',30,false),
  ('analisi_dati','analisi.beauty_days',40,false),
  ('integrazioni','integrazioni',10,true)
on conflict (modulo_codice,schermata_codice) do nothing;

alter table public.workspace_schermate enable row level security;
alter table public.workspace_moduli_schermate enable row level security;

drop policy if exists "authenticated read workspace screens" on public.workspace_schermate;
create policy "authenticated read workspace screens" on public.workspace_schermate
for select to authenticated using (true);
drop policy if exists "admins manage workspace screens" on public.workspace_schermate;
create policy "admins manage workspace screens" on public.workspace_schermate
for all to authenticated using (public.workspace_user_is_admin()) with check (public.workspace_user_is_admin());

drop policy if exists "authenticated read workspace module screens" on public.workspace_moduli_schermate;
create policy "authenticated read workspace module screens" on public.workspace_moduli_schermate
for select to authenticated using (true);
drop policy if exists "admins manage workspace module screens" on public.workspace_moduli_schermate;
create policy "admins manage workspace module screens" on public.workspace_moduli_schermate
for all to authenticated using (public.workspace_user_is_admin()) with check (public.workspace_user_is_admin());

grant select on public.workspace_schermate, public.workspace_moduli_schermate to authenticated;

alter table public.reparti_moduli drop constraint if exists reparti_moduli_modulo_check;
alter table public.reparti_moduli drop constraint if exists reparti_moduli_modulo_fkey;
alter table public.reparti_moduli add constraint reparti_moduli_modulo_fkey
  foreign key (modulo) references public.workspace_moduli(codice) on update cascade on delete cascade;

create or replace function public.protect_workspace_catalog_records()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' and old.protetto then
    raise exception 'Il modulo % è protetto e non può essere eliminato.', old.codice;
  end if;
  if tg_op='UPDATE' and old.protetto and (new.attivo is false or new.sempre_disponibile is false) then
    raise exception 'Il modulo % deve restare attivo e disponibile.', old.codice;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists protect_workspace_modules on public.workspace_moduli;
create trigger protect_workspace_modules before update or delete on public.workspace_moduli
for each row execute function public.protect_workspace_catalog_records();

create or replace function public.protect_workspace_screen_records()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' and old.protetta then
    raise exception 'La schermata % è protetta e non può essere eliminata.', old.codice;
  end if;
  if tg_op='UPDATE' and old.protetta and new.attiva is false then
    raise exception 'La schermata % deve restare attiva.', old.codice;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

drop trigger if exists protect_workspace_screens on public.workspace_schermate;
create trigger protect_workspace_screens before update or delete on public.workspace_schermate
for each row execute function public.protect_workspace_screen_records();

create or replace function public.protect_last_workspace_screen_link()
returns trigger language plpgsql set search_path=public as $$
begin
  if exists (select 1 from public.workspace_schermate where codice=old.schermata_codice and protetta)
     and not exists (
       select 1 from public.workspace_moduli_schermate
       where schermata_codice=old.schermata_codice and modulo_codice<>old.modulo_codice
     ) then
    raise exception 'La schermata protetta % deve appartenere ad almeno un modulo.', old.schermata_codice;
  end if;
  return old;
end $$;

drop trigger if exists protect_last_workspace_screen_link on public.workspace_moduli_schermate;
create trigger protect_last_workspace_screen_link before delete on public.workspace_moduli_schermate
for each row execute function public.protect_last_workspace_screen_link();

create or replace function public.admin_save_workspace_module(
  target_module jsonb,
  target_screen_codes text[],
  target_default_screen text
)
returns void language plpgsql security definer set search_path=public as $$
declare
  target_code text := lower(btrim(coalesce(target_module->>'codice','')));
  target_path text;
begin
  if not public.workspace_user_is_admin() then raise exception 'Operazione riservata all''amministratore Workspace.'; end if;
  if target_code !~ '^[a-z0-9_]+$' or btrim(coalesce(target_module->>'nome',''))='' then raise exception 'Codice o nome modulo non valido.'; end if;
  if coalesce(array_length(target_screen_codes,1),0)=0 then raise exception 'Il modulo deve contenere almeno una schermata.'; end if;
  if target_default_screen is null or not (target_default_screen=any(target_screen_codes)) then target_default_screen := target_screen_codes[1]; end if;
  select percorso into target_path from public.workspace_schermate where codice=target_default_screen and attiva;
  if target_path is null then raise exception 'Schermata iniziale non disponibile.'; end if;

  insert into public.workspace_moduli
    (codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,aggiornato_il)
  values
    (target_code,btrim(target_module->>'nome'),nullif(btrim(target_module->>'descrizione'),''),coalesce(nullif(target_module->>'tipo',''),'modulo'),nullif(btrim(target_module->>'area'),''),target_path,coalesce(nullif(target_module->>'provider',''),'workspace'),false,coalesce((target_module->>'assegnabile_reparto')::boolean,false),coalesce((target_module->>'configurabile_ruolo')::boolean,true),coalesce((target_module->>'mostra_menu')::boolean,true),coalesce((target_module->>'attivo')::boolean,true),coalesce((target_module->>'ordine')::integer,0),now())
  on conflict (codice) do update set
    nome=excluded.nome, descrizione=excluded.descrizione, tipo=excluded.tipo, area=excluded.area,
    percorso=excluded.percorso, provider=excluded.provider,
    assegnabile_reparto=case when workspace_moduli.protetto then false else excluded.assegnabile_reparto end,
    configurabile_ruolo=excluded.configurabile_ruolo, mostra_menu=excluded.mostra_menu,
    attivo=case when workspace_moduli.protetto then true else excluded.attivo end,
    ordine=excluded.ordine, aggiornato_il=now();

  delete from public.workspace_moduli_schermate
  where modulo_codice=target_code and not (schermata_codice=any(target_screen_codes));
  insert into public.workspace_moduli_schermate (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
  select target_code, code, ordinality::integer*10, code=target_default_screen, true
  from unnest(target_screen_codes) with ordinality as selected(code,ordinality)
  join public.workspace_schermate screen on screen.codice=selected.code and screen.attiva
  on conflict (modulo_codice,schermata_codice) do update set
    ordine=excluded.ordine, predefinita=excluded.predefinita, visibile_menu=true;
end $$;

create or replace function public.admin_delete_workspace_module(target_code text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.workspace_user_is_admin() then raise exception 'Operazione riservata all''amministratore Workspace.'; end if;
  delete from public.workspace_moduli where codice=target_code;
end $$;

create or replace function public.admin_update_workspace_screen(target_screen jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.workspace_user_is_admin() then raise exception 'Operazione riservata all''amministratore Workspace.'; end if;
  update public.workspace_schermate set
    nome=btrim(target_screen->>'nome'),
    descrizione=nullif(btrim(target_screen->>'descrizione'),''),
    attiva=case when protetta then true else coalesce((target_screen->>'attiva')::boolean,true) end,
    ordine=coalesce((target_screen->>'ordine')::integer,ordine)
  where codice=target_screen->>'codice';
end $$;

revoke all on function public.admin_save_workspace_module(jsonb,text[],text), public.admin_delete_workspace_module(text), public.admin_update_workspace_screen(jsonb) from public, anon;
grant execute on function public.admin_save_workspace_module(jsonb,text[],text), public.admin_delete_workspace_module(text), public.admin_update_workspace_screen(jsonb) to authenticated;

commit;

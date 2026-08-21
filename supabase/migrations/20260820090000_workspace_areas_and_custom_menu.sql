begin;

create table if not exists public.workspace_aree (
  codice text primary key check (codice ~ '^[a-z0-9_]+$'),
  nome text not null,
  descrizione text,
  icona text not null default 'blocks',
  ordine integer not null default 0,
  attiva boolean not null default true,
  protetta boolean not null default false,
  aggiornata_il timestamptz not null default now()
);

insert into public.workspace_aree (codice,nome,descrizione,icona,ordine,attiva,protetta)
values
  ('workspace','Workspace','Funzioni trasversali disponibili nel Workspace.','home',10,true,true),
  ('operativita','Operativita','Attivita, progetti e organizzazione del lavoro.','clipboard',20,true,false),
  ('commerciale','Commerciale','Ordini, clienti e attivita commerciali.','shopping-cart',30,true,false),
  ('anagrafiche','Anagrafiche','Prodotti e archivi anagrafici.','package',40,true,false),
  ('documentale','Documentale','Documenti e archivi aziendali.','file-archive',50,true,false),
  ('produzione','Produzione','Pianificazione, produzione e funzioni ProgreMES.','factory',60,true,false),
  ('analisi','Analisi','Cruscotti e analisi dati.','chart',70,true,false),
  ('collaborazione','Collaborazione','Messaggi, notifiche e lavoro condiviso.','message',80,true,false),
  ('amministrazione','Amministrazione','Impostazioni, accessi e integrazioni.','settings',90,true,true)
on conflict (codice) do update set
  nome=excluded.nome,
  descrizione=coalesce(workspace_aree.descrizione,excluded.descrizione),
  aggiornata_il=now();

-- Conserva anche eventuali valori Area creati in precedenza come testo libero.
insert into public.workspace_aree (codice,nome,ordine)
select distinct
  lower(btrim(area)),
  initcap(replace(lower(btrim(area)),'_',' ')),
  500
from public.workspace_moduli
where nullif(btrim(area),'') is not null
  and lower(btrim(area)) ~ '^[a-z0-9_]+$'
on conflict (codice) do nothing;

update public.workspace_moduli set area='workspace' where nullif(btrim(area),'') is null;
update public.workspace_moduli set area=lower(btrim(area));

alter table public.workspace_moduli drop constraint if exists workspace_moduli_area_fkey;
alter table public.workspace_moduli
  alter column area set default 'workspace',
  alter column area set not null,
  add constraint workspace_moduli_area_fkey foreign key (area)
    references public.workspace_aree(codice) on update cascade on delete restrict;

alter table public.workspace_schermate add column if not exists area text;

update public.workspace_schermate schermata
set area=coalesce((
  select modulo.area
  from public.workspace_moduli_schermate collegamento
  join public.workspace_moduli modulo on modulo.codice=collegamento.modulo_codice
  where collegamento.schermata_codice=schermata.codice
  order by collegamento.predefinita desc,collegamento.ordine,modulo.ordine
  limit 1
),'workspace')
where nullif(btrim(schermata.area),'') is null;

alter table public.workspace_schermate drop constraint if exists workspace_schermate_area_fkey;
alter table public.workspace_schermate
  alter column area set default 'workspace',
  alter column area set not null,
  add constraint workspace_schermate_area_fkey foreign key (area)
    references public.workspace_aree(codice) on update cascade on delete restrict;

create or replace function public.workspace_default_screen_area()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.provider='progremes' and new.area='workspace' then new.area='produzione'; end if;
  return new;
end $$;

drop trigger if exists workspace_default_screen_area on public.workspace_schermate;
create trigger workspace_default_screen_area
before insert on public.workspace_schermate
for each row execute function public.workspace_default_screen_area();

create table if not exists public.workspace_reparti_aree (
  reparto_id uuid not null references public.reparti(id) on delete cascade,
  area_codice text not null references public.workspace_aree(codice) on update cascade on delete cascade,
  primary key (reparto_id,area_codice)
);

create table if not exists public.workspace_ruoli_aree (
  ruolo_id uuid not null references public.ruoli(id) on delete cascade,
  area_codice text not null references public.workspace_aree(codice) on update cascade on delete cascade,
  primary key (ruolo_id,area_codice)
);

create table if not exists public.workspace_utenti_aree (
  utente_id uuid not null references public.utenti(id) on delete cascade,
  area_codice text not null references public.workspace_aree(codice) on update cascade on delete cascade,
  primary key (utente_id,area_codice)
);

-- La migrazione non deve togliere accessi esistenti: inizialmente ogni ruolo e
-- reparto conserva tutte le aree attive. L'admin potra poi restringerle.
insert into public.workspace_ruoli_aree (ruolo_id,area_codice)
select ruolo.id,area.codice from public.ruoli ruolo cross join public.workspace_aree area where area.attiva
on conflict do nothing;

insert into public.workspace_reparti_aree (reparto_id,area_codice)
select reparto.id,area.codice from public.reparti reparto cross join public.workspace_aree area where area.attiva
on conflict do nothing;

create or replace function public.workspace_area_access_codes(target_auth_user_id uuid default auth.uid())
returns text[]
language sql
stable
security definer
set search_path=public
as $$
  with current_profile as (
    select u.id,u.ruolo_id,u.reparto_id
    from public.utenti u
    where u.auth_user_id=target_auth_user_id and u.attivo is not false
    limit 1
  ), departments as (
    select ur.reparto_id from public.utenti_reparti ur join current_profile u on u.id=ur.utente_id
    union
    select u.reparto_id from current_profile u where u.reparto_id is not null
  ), allowed as (
    select a.codice
    from public.workspace_aree a
    where a.attiva and public.workspace_user_is_admin(target_auth_user_id)
    union
    select ra.area_codice from public.workspace_ruoli_aree ra join current_profile u on u.ruolo_id=ra.ruolo_id
    union
    select da.area_codice from public.workspace_reparti_aree da join departments d on d.reparto_id=da.reparto_id
    union
    select ua.area_codice from public.workspace_utenti_aree ua join current_profile u on u.id=ua.utente_id
  )
  select coalesce(array_agg(distinct allowed.codice),'{}'::text[]) from allowed
$$;

create table if not exists public.workspace_menu_voci (
  codice text primary key check (codice ~ '^[a-z0-9_]+$'),
  nome text not null,
  descrizione text,
  icona text not null default 'blocks',
  ordine integer not null default 0,
  attiva boolean not null default true,
  aggiornata_il timestamptz not null default now()
);

create table if not exists public.workspace_menu_moduli (
  voce_codice text not null references public.workspace_menu_voci(codice) on update cascade on delete cascade,
  modulo_codice text not null references public.workspace_moduli(codice) on update cascade on delete cascade,
  ordine integer not null default 0,
  primary key (voce_codice,modulo_codice)
);

-- La prima configurazione riproduce il menu corrente uno-a-uno.
insert into public.workspace_menu_voci (codice,nome,descrizione,icona,ordine,attiva)
select codice,nome,descrizione,icona,ordine,true
from public.workspace_moduli
where attivo and mostra_menu
on conflict (codice) do nothing;

insert into public.workspace_menu_moduli (voce_codice,modulo_codice,ordine)
select codice,codice,10
from public.workspace_moduli
where attivo and mostra_menu
on conflict do nothing;

alter table public.workspace_aree enable row level security;
alter table public.workspace_reparti_aree enable row level security;
alter table public.workspace_ruoli_aree enable row level security;
alter table public.workspace_utenti_aree enable row level security;
alter table public.workspace_menu_voci enable row level security;
alter table public.workspace_menu_moduli enable row level security;

create policy "authenticated read workspace areas" on public.workspace_aree for select to authenticated using (true);
create policy "admins manage workspace areas" on public.workspace_aree for all to authenticated using (public.workspace_user_is_admin()) with check (public.workspace_user_is_admin());
create policy "authenticated read workspace department areas" on public.workspace_reparti_aree for select to authenticated using (true);
create policy "admins manage workspace department areas" on public.workspace_reparti_aree for all to authenticated using (public.workspace_user_is_admin()) with check (public.workspace_user_is_admin());
create policy "authenticated read workspace role areas" on public.workspace_ruoli_aree for select to authenticated using (true);
create policy "admins manage workspace role areas" on public.workspace_ruoli_aree for all to authenticated using (public.workspace_user_is_admin()) with check (public.workspace_user_is_admin());
create policy "authenticated read workspace user areas" on public.workspace_utenti_aree for select to authenticated using (true);
create policy "admins manage workspace user areas" on public.workspace_utenti_aree for all to authenticated using (public.workspace_user_is_admin()) with check (public.workspace_user_is_admin());
create policy "authenticated read workspace menu entries" on public.workspace_menu_voci for select to authenticated using (true);
create policy "admins manage workspace menu entries" on public.workspace_menu_voci for all to authenticated using (public.workspace_user_is_admin()) with check (public.workspace_user_is_admin());
create policy "authenticated read workspace menu modules" on public.workspace_menu_moduli for select to authenticated using (true);
create policy "admins manage workspace menu modules" on public.workspace_menu_moduli for all to authenticated using (public.workspace_user_is_admin()) with check (public.workspace_user_is_admin());

grant select,insert,update,delete on public.workspace_aree,public.workspace_reparti_aree,public.workspace_ruoli_aree,public.workspace_utenti_aree,public.workspace_menu_voci,public.workspace_menu_moduli to authenticated;
revoke all on function public.workspace_area_access_codes(uuid) from public,anon;
grant execute on function public.workspace_area_access_codes(uuid) to authenticated,service_role;

create or replace function public.admin_update_workspace_screen(target_screen jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
  target_area text := lower(btrim(coalesce(target_screen->>'area','workspace')));
begin
  if not public.workspace_user_is_admin() then raise exception 'Operazione riservata all''amministratore Workspace.'; end if;
  if not exists(select 1 from public.workspace_aree where codice=target_area) then raise exception 'Area non valida.'; end if;
  update public.workspace_schermate set
    nome=btrim(target_screen->>'nome'),
    descrizione=nullif(btrim(target_screen->>'descrizione'),''),
    area=target_area,
    attiva=case when protetta then true else coalesce((target_screen->>'attiva')::boolean,true) end,
    ordine=coalesce((target_screen->>'ordine')::integer,ordine)
  where codice=target_screen->>'codice';
end $$;

insert into public.workspace_schermate (
  codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,metadati,ultima_sincronizzazione
)
values (
  'impostazioni.menu','Aree e menu','Aree di accesso e composizione personalizzata del menu Workspace.',
  'workspace','/settings/menu','settings.menu',false,true,45,'amministrazione','{"admin_only":true}'::jsonb,now()
)
on conflict (codice) do update set
  nome=excluded.nome,descrizione=excluded.descrizione,percorso=excluded.percorso,
  chiave_componente=excluded.chiave_componente,attiva=true,area=excluded.area,
  metadati=workspace_schermate.metadati || excluded.metadati,ultima_sincronizzazione=now();

insert into public.workspace_moduli_schermate (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values ('impostazioni','impostazioni.menu',45,false,true)
on conflict (modulo_codice,schermata_codice) do update set ordine=45,predefinita=false,visibile_menu=true;

commit;

-- Introduce il cliente virtuale DIRECT e collega in modo conservativo soltanto
-- progetti/task/attivita ancora privi di cliente. Nessun record operativo viene
-- cancellato, duplicato o rinumerato.

begin;

alter table public.crm_accounts drop constraint if exists crm_accounts_tipo_check;
alter table public.crm_accounts add constraint crm_accounts_tipo_check
  check (tipo in ('conto_terzi','b2b','online','brand_direct'));

alter table public.crm_activities drop constraint if exists crm_activities_crm_tipo_check;
alter table public.crm_activities add constraint crm_activities_crm_tipo_check
  check (crm_tipo in ('conto_terzi','b2b','online','brand_direct'));

create or replace function public.crm_module_for_type(target_type text)
returns text language sql immutable as $$
  select case target_type
    when 'conto_terzi' then 'crm_conto_terzi'
    when 'b2b' then 'crm_b2b'
    when 'online' then 'crm_online'
    when 'brand_direct' then 'crm_brand_direct'
    else null
  end
$$;

insert into public.crm_accounts
  (id,tipo,nome,stato,fonte,codice_cliente_mexal,metadati)
values
  ('00000000-0000-4000-8000-000000000001','brand_direct','DIRECT','attivo',
   'workspace_virtual',null,'{"virtual":true,"code":"DIRECT","scope":"brand"}'::jsonb)
on conflict (id) do update set
  tipo='brand_direct',nome='DIRECT',stato='attivo',fonte='workspace_virtual',
  codice_cliente_mexal=null,
  metadati=coalesce(public.crm_accounts.metadati,'{}'::jsonb) || excluded.metadati,
  aggiornato_il=now();

-- Recupera prima tutti i collegamenti reali ancora deducibili. Questi passaggi
-- valorizzano esclusivamente chiavi mancanti e prevalgono sul fallback DIRECT.
update public.crm_activities activity
set account_id=opportunity.account_id,
    customer_key=coalesce(activity.customer_key,
      case when nullif(account.codice_cliente_mexal,'') is not null
        then 'mexal:'||account.codice_cliente_mexal
        else 'crm:'||account.id::text end)
from public.crm_opportunities opportunity
join public.crm_accounts account on account.id=opportunity.account_id
where activity.opportunity_id=opportunity.id
  and (activity.account_id is null or activity.customer_key is null);

update public.v4_progetti project
set crm_customer_key=case when nullif(account.codice_cliente_mexal,'') is not null
      then 'mexal:'||account.codice_cliente_mexal
      else 'crm:'||account.id::text end
from public.crm_opportunities opportunity
join public.crm_accounts account on account.id=opportunity.account_id
where project.crm_opportunity_id=opportunity.id
  and project.crm_customer_key is null;

update public.v4_progetti project
set crm_customer_key=coalesce(activity.customer_key,
      case when nullif(account.codice_cliente_mexal,'') is not null
        then 'mexal:'||account.codice_cliente_mexal
        else 'crm:'||account.id::text end)
from public.crm_activities activity
left join public.crm_accounts account on account.id=activity.account_id
where project.crm_activity_id=activity.id
  and project.crm_customer_key is null
  and (activity.customer_key is not null or account.id is not null);

update public.v4_fasi_progetto phase
set crm_customer_key=project.crm_customer_key
from public.v4_progetti project
where phase.progetto_id=project.id
  and phase.crm_customer_key is null
  and project.crm_customer_key is not null;

update public.v4_fasi_progetto phase
set crm_customer_key=coalesce(activity.customer_key,
      case when nullif(account.codice_cliente_mexal,'') is not null
        then 'mexal:'||account.codice_cliente_mexal
        else 'crm:'||account.id::text end)
from public.crm_activities activity
left join public.crm_accounts account on account.id=activity.account_id
where phase.crm_activity_id=activity.id
  and phase.crm_customer_key is null
  and (activity.customer_key is not null or account.id is not null);

-- Solo dopo la ricostruzione dei legami reali, assegna il cliente virtuale ai
-- record ancora senza cliente. Identita, date, stati, assegnazioni e contenuti
-- storici restano invariati.
update public.crm_activities
set account_id='00000000-0000-4000-8000-000000000001',
    crm_tipo='brand_direct',
    customer_key='crm:00000000-0000-4000-8000-000000000001'
where account_id is null and customer_key is null;

update public.v4_progetti
set crm_customer_key='crm:00000000-0000-4000-8000-000000000001'
where crm_customer_key is null;

update public.v4_fasi_progetto phase
set crm_customer_key=coalesce(project.crm_customer_key,'crm:00000000-0000-4000-8000-000000000001')
from public.v4_progetti project
where phase.progetto_id=project.id and phase.crm_customer_key is null;

update public.v4_fasi_progetto
set crm_customer_key='crm:00000000-0000-4000-8000-000000000001'
where crm_customer_key is null;

insert into public.workspace_moduli
  (codice,nome,descrizione,tipo,area,percorso,provider,sempre_disponibile,
   assegnabile_reparto,configurabile_ruolo,mostra_menu,attivo,ordine,icona)
values
  ('crm_brand_direct','CRM BRAND DIRECT',
   'Cliente virtuale DIRECT per progetti e attività interne sui prodotti DIRECT.',
   'modulo','crm','/crm/brand-direct','workspace',false,true,true,true,true,68,'briefcase')
on conflict (codice) do update set
  nome=excluded.nome,descrizione=excluded.descrizione,tipo=excluded.tipo,
  area=excluded.area,percorso=excluded.percorso,provider=excluded.provider,
  assegnabile_reparto=excluded.assegnabile_reparto,
  configurabile_ruolo=excluded.configurabile_ruolo,mostra_menu=true,attivo=true,
  ordine=excluded.ordine,icona=excluded.icona,aggiornato_il=now();

update public.workspace_moduli
set dipendenze_alternative=array['crm_brand_direct','crm_b2b','crm_online'],
    aggiornato_il=now()
where codice='crm_direct';

insert into public.reparti_moduli (reparto_id,modulo,creato_il)
select distinct reparto_id,'crm_brand_direct',now()
from public.reparti_moduli
where modulo in ('crm_b2b','crm_online')
on conflict (reparto_id,modulo) do nothing;

insert into public.ruoli_moduli (ruolo_id,modulo,livello_accesso,aggiornato_il)
select distinct on (grant_row.ruolo_id)
  grant_row.ruolo_id,'crm_brand_direct',grant_row.livello_accesso,now()
from public.ruoli_moduli grant_row
where grant_row.modulo in ('crm_direct','crm_b2b','crm_online')
order by grant_row.ruolo_id,
  case grant_row.livello_accesso when 'amministrazione' then 3 when 'scrittura' then 2 else 1 end desc
on conflict (ruolo_id,modulo) do update set
  livello_accesso=excluded.livello_accesso,aggiornato_il=now();

insert into public.workspace_eccezioni_utente
  (utente_id,ambito,codice,decisione,livello_accesso,motivazione,valida_fino_a,
   creata_da,creata_il,aggiornata_il)
select distinct on (exception_row.utente_id)
  exception_row.utente_id,'modulo','crm_brand_direct',exception_row.decisione,
  exception_row.livello_accesso,
  coalesce(exception_row.motivazione,'') || ' · estesa automaticamente a CRM BRAND DIRECT',
  exception_row.valida_fino_a,exception_row.creata_da,now(),now()
from public.workspace_eccezioni_utente exception_row
where exception_row.ambito='modulo'
  and exception_row.codice in ('crm_direct','crm_b2b','crm_online')
  and exception_row.decisione='consenti'
order by exception_row.utente_id,
  case exception_row.livello_accesso when 'amministrazione' then 3 when 'scrittura' then 2 else 1 end desc
on conflict (utente_id,ambito,codice) do nothing;

insert into public.workspace_schermate
  (codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,icona,metadati,ultima_sincronizzazione)
values
  ('crm.brand_direct.dashboard','Dashboard BRAND DIRECT','Sintesi del cliente virtuale DIRECT.','workspace','/crm/brand-direct','crm.brand_direct.dashboard',false,true,10,'crm','briefcase','{}',now()),
  ('crm.brand_direct.progetti','Progetti BRAND DIRECT','Progetti Workspace collegati al cliente virtuale DIRECT.','workspace','/crm/brand-direct/progetti','crm.brand_direct.projects',false,true,20,'crm','folder-kanban','{}',now()),
  ('crm.brand_direct.attivita','Attività BRAND DIRECT','Task Workspace collegate al cliente virtuale DIRECT.','workspace','/crm/brand-direct/attivita','crm.brand_direct.activities',false,true,30,'crm','clipboard-list','{}',now())
on conflict (codice) do update set
  nome=excluded.nome,descrizione=excluded.descrizione,provider=excluded.provider,
  percorso=excluded.percorso,chiave_componente=excluded.chiave_componente,
  attiva=true,ordine=excluded.ordine,area=excluded.area,icona=excluded.icona,
  ultima_sincronizzazione=now();

insert into public.workspace_moduli_schermate
  (modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values
  ('crm_brand_direct','crm.brand_direct.dashboard',1,true,true),
  ('crm_brand_direct','crm.brand_direct.progetti',2,false,true),
  ('crm_brand_direct','crm.brand_direct.attivita',3,false,true)
on conflict (modulo_codice,schermata_codice) do update set
  ordine=excluded.ordine,predefinita=excluded.predefinita,visibile_menu=true;

insert into public.crm_audit_log (entita_tipo,entita_id,operazione,dettagli)
values ('crm_account','00000000-0000-4000-8000-000000000001','brand_direct_backfill',
  jsonb_build_object(
    'projects',(select count(*) from public.v4_progetti where crm_customer_key='crm:00000000-0000-4000-8000-000000000001'),
    'tasks',(select count(*) from public.v4_fasi_progetto where crm_customer_key='crm:00000000-0000-4000-8000-000000000001'),
    'activities',(select count(*) from public.crm_activities where account_id='00000000-0000-4000-8000-000000000001'),
    'strategy','missing-customer-only'
  ));

comment on table public.crm_accounts is
  'Anagrafica CRM; include DIRECT come cliente virtuale Workspace senza corrispondenza Mexal.';

commit;

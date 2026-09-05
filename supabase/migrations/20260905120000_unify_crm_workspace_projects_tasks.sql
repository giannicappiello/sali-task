-- CRM PRIVATE and Workspace Attivita use v4_progetti/v4_fasi_progetto as the
-- only operational project/task store. This migration is additive: it does not
-- delete or renumber any existing project, task, CRM activity or opportunity.

begin;

create or replace function public.workspace_inherit_project_customer()
returns trigger
language plpgsql security definer
set search_path=public as $$
declare
  v_customer_key text;
  v_opportunity_id uuid;
begin
  if new.progetto_id is null then return new; end if;

  select crm_customer_key,crm_opportunity_id
  into v_customer_key,v_opportunity_id
  from public.v4_progetti
  where id=new.progetto_id;

  new.crm_customer_key := coalesce(new.crm_customer_key,v_customer_key);
  new.crm_opportunity_id := coalesce(new.crm_opportunity_id,v_opportunity_id);
  return new;
end;
$$;

revoke all on function public.workspace_inherit_project_customer() from public,anon,authenticated;

drop trigger if exists trg_workspace_inherit_project_customer on public.v4_fasi_progetto;
create trigger trg_workspace_inherit_project_customer
before insert or update of progetto_id,crm_customer_key,crm_opportunity_id
on public.v4_fasi_progetto
for each row execute function public.workspace_inherit_project_customer();

create or replace function public.workspace_propagate_project_customer()
returns trigger
language plpgsql security definer
set search_path=public as $$
begin
  update public.v4_fasi_progetto
  set crm_customer_key=coalesce(crm_customer_key,new.crm_customer_key),
      crm_opportunity_id=coalesce(crm_opportunity_id,new.crm_opportunity_id),
      updated_at=now()
  where progetto_id=new.id
    and (
      (crm_customer_key is null and new.crm_customer_key is not null)
      or (crm_opportunity_id is null and new.crm_opportunity_id is not null)
    );
  return new;
end;
$$;

revoke all on function public.workspace_propagate_project_customer() from public,anon,authenticated;

drop trigger if exists trg_workspace_propagate_project_customer on public.v4_progetti;
create trigger trg_workspace_propagate_project_customer
after insert or update of crm_customer_key,crm_opportunity_id
on public.v4_progetti
for each row execute function public.workspace_propagate_project_customer();

-- Preserve and surface projects linked with the former bridge table. Only CRM
-- references that are still missing are enriched; operational data is untouched.
update public.v4_progetti project
set crm_opportunity_id=coalesce(project.crm_opportunity_id,opportunity.id),
    crm_customer_key=coalesce(
      project.crm_customer_key,
      case when nullif(account.codice_cliente_mexal,'') is not null
        then 'mexal:'||account.codice_cliente_mexal
        else 'crm:'||account.id::text
      end
    )
from public.crm_workspace_links link
join public.crm_opportunities opportunity
  on link.crm_entity_type='opportunity'
 and link.crm_entity_id=opportunity.id
join public.crm_accounts account on account.id=opportunity.account_id
where link.workspace_entity_type='project'
  and link.workspace_entity_id=project.id
  and (project.crm_customer_key is null or project.crm_opportunity_id is null);

-- Enrich only missing references on historical phases. Existing values, titles,
-- states, deadlines, assignments and IDs remain untouched.
update public.v4_fasi_progetto phase
set crm_customer_key=project.crm_customer_key,
    crm_opportunity_id=coalesce(phase.crm_opportunity_id,project.crm_opportunity_id)
from public.v4_progetti project
where phase.progetto_id=project.id
  and phase.crm_customer_key is null
  and project.crm_customer_key is not null;

update public.workspace_moduli_schermate
set visibile_menu=false
where modulo_codice='crm_conto_terzi'
  and schermata_codice='crm.conto_terzi.opportunita';

update public.workspace_moduli_schermate
set visibile_menu=true,ordine=3
where modulo_codice='crm_conto_terzi'
  and schermata_codice='crm.conto_terzi.progetti';

comment on function public.workspace_inherit_project_customer() is
  'Mantiene cliente e opportunita del progetto sulle nuove task/fasi senza duplicare record CRM.';
comment on function public.workspace_propagate_project_customer() is
  'Propaga solo riferimenti CRM mancanti alle task/fasi dello stesso progetto, preservando lo storico.';

commit;

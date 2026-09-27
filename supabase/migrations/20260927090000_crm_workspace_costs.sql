begin;
create table public.crm_workspace_costs (
 id uuid primary key default gen_random_uuid(),
 project_id uuid references public.v4_progetti(id) on delete restrict,
 phase_id uuid references public.v4_fasi_progetto(id) on delete restrict,
 cost_date date not null default current_date,
 description text not null check(length(trim(description)) between 1 and 1000),
 amount numeric(14,2) not null check(amount >= 0 and amount <> 'NaN'::numeric),
 created_by uuid not null default public.workspace_current_profile_id(),
 created_at timestamptz not null default now(),
 check(num_nonnulls(project_id,phase_id)=1)
);
create index on public.crm_workspace_costs(project_id);
create index on public.crm_workspace_costs(phase_id);
create index on public.crm_workspace_costs(cost_date);
alter table public.crm_workspace_costs enable row level security;
-- Target queries retain the existing Workspace RLS and CRM scope.
create policy costs_read on public.crm_workspace_costs for select to authenticated using (
 public.crm_has_module_level('crm_conto_terzi','lettura') and (
 exists(select 1 from public.v4_progetti p where p.id=project_id and p.crm_tipo='conto_terzi') or
 exists(select 1 from public.v4_fasi_progetto f where f.id=phase_id and f.crm_tipo='conto_terzi')));
create policy costs_write on public.crm_workspace_costs for all to authenticated using (
 public.crm_has_module_level('crm_conto_terzi','scrittura') and (
 exists(select 1 from public.v4_progetti p where p.id=project_id and p.crm_tipo='conto_terzi') or
 exists(select 1 from public.v4_fasi_progetto f where f.id=phase_id and f.crm_tipo='conto_terzi')))
 with check(public.crm_has_module_level('crm_conto_terzi','scrittura') and (
 exists(select 1 from public.v4_progetti p where p.id=project_id and p.crm_tipo='conto_terzi') or
 exists(select 1 from public.v4_fasi_progetto f where f.id=phase_id and f.crm_tipo='conto_terzi')));
grant select,insert,update,delete on public.crm_workspace_costs to authenticated;
grant all on public.crm_workspace_costs to service_role;
insert into public.workspace_schermate(codice,nome,descrizione,provider,percorso,chiave_componente,protetta,attiva,ordine,area,icona,metadati,ultima_sincronizzazione)
values('crm.conto_terzi.rendicontazione','Rendicontazione PRIVATE','Costi consuntivi di task, fasi e progetti Workspace.','workspace','/crm/conto-terzi/rendicontazione','crm.costs',false,true,26,'crm','chart','{}',now());
insert into public.workspace_moduli_schermate(modulo_codice,schermata_codice,ordine,predefinita,visibile_menu)
values('crm_conto_terzi','crm.conto_terzi.rendicontazione',26,false,true);
update public.workspace_moduli_schermate set visibile_menu=false,predefinita=false where modulo_codice='crm_conto_terzi' and schermata_codice in ('crm.conto_terzi.sviluppi','crm.conto_terzi.pipeline');
update public.workspace_schermate set protetta=false,attiva=false where codice in ('crm.conto_terzi.sviluppi','crm.conto_terzi.pipeline');
commit;

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260903150000_crm_workspace_activity_orchestration.sql");
const canonicalMigration = read("supabase/migrations/20260905100000_crm_workspace_canonical_activities.sql");
const unifiedMigration = read("supabase/migrations/20260905120000_unify_crm_workspace_projects_tasks.sql");
const opportunity = read("src/modules/crm/CrmOpportunityDetail.jsx");
const activityTypes = read("src/components/ProjectTypesSettings.jsx");
const tasks = read("src/pages/Tasks/Tasks.jsx");
const projects = read("src/pages/Projects/Projects.jsx");
const kanban = read("src/pages/Tasks/WorkspaceTaskKanban.jsx");
const ai = read("server/ai/crm-brief.js");
const css = read("src/modules/crm/workspace-alignment.css");

test("riusa il motore Workspace senza introdurre task o progetti CRM duplicati", () => {
  assert.match(migration, /insert into public\.v4_progetti/);
  assert.match(migration, /insert into public\.v4_fasi_progetto/);
  assert.match(migration, /public\.tipo_progetto_fasi/);
  assert.doesNotMatch(migration, /create table[^;]*(crm_tasks|crm_projects)/i);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public\./i);
});

test("tipi CRM PRIVATE semplici e strutturati sono configurabili e auditati", () => {
  assert.match(migration, /create table if not exists public\.crm_activity_types/);
  for (const code of ["telefonata", "follow_up", "riunione", "preventivo", "valutazione_fattibilita", "sviluppo_nuova_formula", "campionatura", "invio_campioni", "revisione_packaging", "preparazione_documentazione"]) {
    assert.match(migration, new RegExp(`'conto_terzi','${code}'`));
  }
  assert.match(migration, /trg_crm_activity_types_audit/);
  assert.match(activityTypes, /Tipi attività CRM PRIVATE/);
  assert.match(activityTypes, /tipo_progetto_id/);
});

test("anteprima e conferma sono distinte, atomiche e idempotenti", () => {
  assert.match(migration, /crm_preview_operational_activity/);
  assert.match(migration, /crm_create_operational_activity/);
  assert.match(migration, /crm_activities_idempotency_uidx/);
  assert.match(migration, /'idempotent',true/);
  assert.match(opportunity, /Anteprima creazione/);
  assert.match(opportunity, /Conferma e crea/);
  assert.match(opportunity, /project_count/);
  assert.match(opportunity, /task_count/);
  assert.match(opportunity, /department_count/);
});

test("deadline a ritroso, reparti, responsabili e dipendenze usano la configurazione progetto", () => {
  assert.match(migration, /p_deadline-coalesce\(r\.giorni_anticipo,0\)/);
  assert.match(migration, /durata_giorni/);
  assert.match(migration, /dipende_da_id/);
  assert.match(migration, /bloccante_id/);
  assert.match(migration, /workspace_unblock_dependent_tasks/);
  assert.match(migration, /checklist_template_reparti/);
  assert.match(projects, /createdByRule/);
  assert.match(projects, /responsabile_id/);
});

test("avanzamento CRM deriva dagli stati reali Workspace ed è bidirezionale", () => {
  assert.match(migration, /crm_opportunity_operational_progress/);
  assert.match(migration, /completed_tasks/);
  assert.match(migration, /blocked_tasks/);
  assert.match(migration, /overdue_tasks/);
  assert.match(migration, /update public\.crm_activities set stato='completata'/);
  assert.match(opportunity, /L’avanzamento deriva dagli stati reali delle task/);
  assert.match(opportunity, /Apri progetto/);
  assert.match(opportunity, /Apri task/);
  assert.match(opportunity, /ATTIVITÀ SCADUTA/);
  assert.match(opportunity, /NESSUNA ATTIVITÀ PIANIFICATA/);
  assert.match(opportunity, /Responsabile non assegnato/);
  assert.match(kanban, /Apri opportunità CRM/);
  assert.match(kanban, /\/crm\/conto-terzi\/pipeline\/\$\{item\.crm_opportunity_id\}/);
  assert.match(projects, /requestedProjectId/);
  assert.match(projects, /Torna all’opportunità CRM/);
});

test("Kanban e Il mio lavoro operano sul dataset Workspace con filtri persistenti", () => {
  for (const column of ["Da fare", "In lavorazione", "Bloccata", "In verifica", "Completata"]) assert.match(kanban, new RegExp(column));
  assert.match(tasks, /Il mio lavoro/);
  assert.match(tasks, /Questa settimana/);
  assert.match(tasks, /Bloccate/);
  assert.match(tasks, /params\.get\("origin"\)/);
  assert.match(tasks, /params\.get\("department"\)/);
  assert.match(tasks, /setParams/);
});

test("RLS e assegnazioni non allargano il perimetro corrente", () => {
  assert.match(migration, /crm activity types admin/);
  assert.match(migration, /crm_has_module_level\(public\.crm_module_for_type\(v_account\.tipo\),'scrittura'\)/);
  assert.match(migration, /crm_has_module_level\('attivita','scrittura'\)/);
  assert.match(migration, /crm_user_can_assign_department/);
  assert.match(migration, /crm_user_can_assign_responsible/);
});

test("AI propone un tipo configurato e crea solo dopo conferma umana", () => {
  assert.match(ai, /configuredActivityTypes/);
  assert.match(ai, /activityTypeCode/);
  assert.match(ai, /crm_create_operational_activity/);
  assert.match(ai, /p_idempotency_key: `crm-ai:/);
  assert.match(ai, /action === "approve"/);
  assert.doesNotMatch(ai, /service_role.*crm_create_operational_activity/i);
});

test("layout operativo mantiene responsive e focus Workspace", () => {
  assert.match(css, /crm-operational-grid/);
  assert.match(css, /crm-operational-form/);
  assert.match(opportunity, /panel-header crm-operational-heading/);
  assert.match(opportunity, /panel crm-operational-card/);
  assert.match(opportunity, /className="secondary-action"/);
  assert.match(css, /@media\s*\(max-width:\s*1024px\)/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(kanban, /aria-label="Kanban task Workspace"/);
  assert.match(kanban, /panel workspace-task-column/);
  assert.match(kanban, /secondary-action workspace-task-link/);
});

test("assegnatari task usano il profilo Workspace canonico", () => {
  const repair = read("supabase/migrations/20260903153000_fix_crm_workspace_task_assignee_fk.sql");
  assert.match(repair, /foreign key \(assegnato_a\) references public\.utenti\(id\) on delete set null/i);
  assert.match(tasks, /responsabile:utenti!v4_fasi_progetto_assegnato_a_fkey/);
  assert.match(projects, /responsabile:utenti!v4_fasi_progetto_assegnato_a_fkey/);
});

test("ogni nuova attività CRM ottiene una task Workspace senza duplicare i workflow strutturati", () => {
  assert.match(canonicalMigration, /create constraint trigger trg_crm_deferred_ensure_workspace_task/i);
  assert.match(canonicalMigration, /deferrable initially deferred/i);
  assert.match(canonicalMigration, /crm_ensure_workspace_task\(new\.id\)/i);
  assert.match(canonicalMigration, /if v_project_id is not null then[\s\S]*return null/i);
  assert.match(canonicalMigration, /where f\.crm_activity_id=v_activity\.id/i);
  assert.match(canonicalMigration, /if v_task_id is null then[\s\S]*insert into public\.v4_fasi_progetto/i);
});

test("il backfill canonico preserva integralmente lo storico esistente", () => {
  assert.match(canonicalMigration, /Backfill only CRM activities still lacking every operational counterpart/i);
  assert.match(canonicalMigration, /not exists\(select 1 from public\.v4_progetti/i);
  assert.match(canonicalMigration, /not exists\(select 1 from public\.v4_fasi_progetto/i);
  assert.doesNotMatch(canonicalMigration, /delete\s+from\s+public\.(crm_activities|v4_progetti|v4_fasi_progetto)/i);
  assert.doesNotMatch(canonicalMigration, /truncate\s+table/i);
  assert.doesNotMatch(canonicalMigration, /drop\s+table/i);
});

test("la task primaria e l'attività CRM restano sincronizzate in entrambe le direzioni", () => {
  assert.match(canonicalMigration, /crm_sync_activity_to_workspace_task/i);
  assert.match(canonicalMigration, /workspace_sync_task_to_crm_activity/i);
  assert.match(canonicalMigration, /a\.workspace_task_id=new\.id/i);
  assert.match(canonicalMigration, /crm_workspace_canonical_activities/i);
  assert.match(canonicalMigration, /crm_workspace_activity_integrity/i);
});

test("CRM PRIVATE e Attività condividono progetti, task e cliente canonici", () => {
  const crmProjects = read("src/modules/crm/CrmWorkflowPages.jsx");
  const crmActivities = read("src/modules/crm/CrmActivitiesPage.jsx");
  const customerPicker = read("src/components/WorkspaceCustomerPicker.jsx");
  assert.match(crmProjects, /from\("v4_progetti"\)/);
  assert.match(crmActivities, /from\("v4_fasi_progetto"\)/);
  assert.doesNotMatch(crmActivities, /from\("crm_activities"\)/);
  assert.match(projects, /WorkspaceCustomerPicker/);
  assert.match(projects, /crm_customer_key/);
  assert.match(projects, /createProjectTypePhases/);
  assert.match(customerPicker, /Ricerca rapida cliente o codice/);
  assert.match(unifiedMigration, /workspace_inherit_project_customer/);
  assert.match(unifiedMigration, /workspace_propagate_project_customer/);
  assert.match(unifiedMigration, /phase\.crm_customer_key is null/);
  assert.doesNotMatch(unifiedMigration, /delete from public\.(v4_progetti|v4_fasi_progetto|crm_activities|crm_opportunities)/i);
});

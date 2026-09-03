import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260903150000_crm_workspace_activity_orchestration.sql");
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

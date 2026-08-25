import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, rlsMigration, atomicMigration, app, guard, crmModule, crmAI, vercel] = await Promise.all([
  readFile("supabase/migrations/20260824120000_crm_platform_ai.sql", "utf8"),
  readFile("supabase/migrations/20260824121000_crm_rls_write_levels.sql", "utf8"),
  readFile("supabase/migrations/20260824122000_crm_atomic_ai_application.sql", "utf8"),
  readFile("src/App.jsx", "utf8"),
  readFile("src/components/WorkspaceAccessGuard.jsx", "utf8"),
  readFile("src/modules/crm/CrmModule.jsx", "utf8"),
  readFile("server/ai/crm-brief.js", "utf8"),
  readFile("vercel.json", "utf8"),
]);

test("CRM usa catalogo Workspace, area, moduli e schermate reali", () => {
  for (const code of ["crm", "crm_conto_terzi", "crm_b2b", "crm_online", "crm_ai"]) {
    assert.match(migration, new RegExp(`'${code}'`));
  }
  for (const screen of ["crm.dashboard", "crm.conto_terzi.clienti", "crm.b2b.clienti", "crm.online.campaigns", "crm.ai"]) {
    assert.match(migration, new RegExp(screen.replaceAll(".", "\\.")));
  }
  assert.match(migration, /workspace_menu_voci/);
  assert.match(migration, /workspace_moduli_schermate/);
  assert.match(migration, /dipendenze_alternative/);
});

test("route CRM richiedono modulo e schermata di catalogo", () => {
  assert.match(app, /path="crm\/\*"/);
  assert.match(crmModule, /CRM_ROUTE_CATALOG\.map/);
  assert.match(crmModule, /<Screen moduleCode=\{route\.moduleCode\} screenCode=\{route\.screenCode\}>/);
  assert.match(guard, /workspace_schermate/);
  assert.match(guard, /workspace_moduli_schermate/);
  assert.match(guard, /hasScreenAccess\(screenCode, moduleCode\)/);
});

test("CRM Core non duplica task o catalogo prodotti", () => {
  assert.doesNotMatch(migration, /create table if not exists public\.crm_tasks/i);
  assert.doesNotMatch(migration, /create table if not exists public\.crm_products/i);
  assert.match(atomicMigration, /insert into public\.v4_progetti/);
  assert.match(atomicMigration, /insert into public\.v4_fasi_progetto/);
  assert.match(atomicMigration, /insert into public\.agenda_reminder/);
  assert.match(crmAI, /from\("prodotti"\)/);
});

test("RLS CRM deriva da moduli, livello operativo e ambito dati Workspace", () => {
  assert.match(migration, /crm_has_module_level/);
  assert.match(migration, /workspace_module_enabled_for_user/);
  assert.match(migration, /ambito_dati/);
  assert.match(migration, /utenti_reparti/);
  assert.match(migration, /enable row level security/);
  assert.doesNotMatch(migration, /role_name|crm_admin|crm_manager/i);
});

test("AI legge con client utente e applica soltanto dopo approvazione", () => {
  assert.match(crmAI, /global: \{ headers: \{ Authorization:/);
  assert.match(crmAI, /body\.action === "approve"/);
  assert.match(crmAI, /readyForApproval !== true/);
  assert.match(crmAI, /decision\.stato !== "proposta"/);
  assert.match(crmAI, /piano_ai_proposto/);
  assert.match(atomicMigration, /decisione_ai_approvata_e_progetto_creato/);
  assert.match(vercel, /\/api\/ai\/crm-brief/);
});

test("KPI operativi distinguono fatturato Mexal e ordinato Workspace", () => {
  assert.match(crmModule, /\.rpc\("crm_dashboard_metrics"/);
  assert.match(crmModule, /invoice_source_note/);
  assert.match(crmModule, /order_source_note/);
  assert.match(crmModule, /Riferimento consenso/);
});
test("le policy di scrittura non trasformano la sola lettura in modifica", () => {
  assert.match(rlsMigration, /crm contacts read/);
  assert.match(rlsMigration, /crm contacts write[\s\S]*crm_has_module_level/i);
  assert.match(rlsMigration, /crm opportunities read/);
  assert.match(rlsMigration, /crm opportunities write[\s\S]*crm_has_module_level/i);
});

test("applicazione AI atomica, autorizzata e idempotente", () => {
  assert.match(atomicMigration, /crm_apply_ai_decision/);
  assert.match(atomicMigration, /for update/i);
  assert.match(atomicMigration, /decision_row\.stato='applicata'/i);
  assert.match(atomicMigration, /crm_has_module_level\('attivita','scrittura'\)/i);
  assert.match(atomicMigration, /crm_ai_decisions_project_unique/);
  assert.match(crmAI, /\.rpc\("crm_apply_ai_decision"/);
  assert.doesNotMatch(crmAI, /\.from\("v4_progetti"\)\.insert/);
});

test("conversazioni AI e link Workspace rispettano il perimetro autorizzato", () => {
  assert.match(atomicMigration, /crm brief messages read[\s\S]*crm_has_module_level\('crm_ai','lettura'\)/i);
  assert.match(atomicMigration, /crm decisions read[\s\S]*crm_has_module_level\('crm_ai','lettura'\)/i);
  assert.match(atomicMigration, /crm links read[\s\S]*crm_row_visible/i);
  assert.match(atomicMigration, /crm_audit_row_change/);
});

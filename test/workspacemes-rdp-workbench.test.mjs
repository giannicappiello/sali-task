import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { appendProgremesContext } from "../server/progremes-sso.js";

const [ui, productionCss, production, api, migration, cancellationMigration, cancellationRefinementMigration, legacyCancellationMigration, reopenMigration, progressiveMigration, workbench] = await Promise.all([
  readFile("src/pages/Production/RdpWorkbench.jsx", "utf8"),
  readFile("src/pages/Production/production.css", "utf8"),
  readFile("src/pages/Production/Production.jsx", "utf8"),
  readFile("api/mexal/automation.js", "utf8"),
  readFile("supabase/migrations/20260826170000_workspacemes_rdp_create_permission.sql", "utf8"),
  readFile("supabase/migrations/20260827100000_workspacemes_rdp_controlled_cancellation.sql", "utf8"),
  readFile("supabase/migrations/20260827103000_refine_rdp_cancellation_effect_events.sql", "utf8"),
  readFile("supabase/migrations/20260828170000_allow_legacy_awaiting_decision_cancellation.sql", "utf8"),
  readFile("supabase/migrations/20260827110000_reopen_orders_after_cancelled_rdp.sql", "utf8"),
  readFile("supabase/migrations/20260828184500_workspace_rdp_progressive_number.sql", "utf8"),
  readFile("server/workspacemes-workbench.js", "utf8"),
]);

test("Workbench espone lista OCT, multi-select e stati operativi senza duplicare le schermate MES", () => {
  for (const label of ["OCT da valutare", "RdP", "In produzione", "Completati / evasi", "Bloccati"]) assert.match(ui, new RegExp(label, "i"));
  assert.match(ui, /type="checkbox"/);
  assert.match(ui, /orderIds: selected/);
  assert.doesNotMatch(ui, /NESSUNA NETTIFICAZIONE WORKSPACE/);
  assert.doesNotMatch(ui, /ProgreMES è il master dell’analisi produttiva/);
  assert.doesNotMatch(ui, /Filtra cliente/);
  assert.match(ui, /rdp-header-actions/);
  assert.match(ui, /rdp-header-controls/);
  assert.match(ui, /rowRdpLabel && <span className="rdp-oct-rdp">\{rowRdpLabel\}<\/span>/);
  assert.match(workbench, /rdpNumber: request\?\.rdp_number \|\| null/);
  assert.match(workbench, /rdpNumber: request\.rdp_number \|\| null/);
  assert.match(productionCss, /\.rdp-oct-reference\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(ui, /rdp-toolbar-evaluation/);
  assert.match(ui, /className="rdp-oct-scroll"/);
  assert.match(productionCss, /\.rdp-oct-scroll\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(productionCss, /\.rdp-oct-meta\s*\{[^}]*font-size:\s*\.72rem/);
  assert.match(productionCss, /\.rdp-request-meta \.rdp-cancel-action\s*\{[^}]*margin-left:\s*auto/);
  assert.match(ui, /requestId: response\.requestId/);
  assert.match(ui, /setDetail\(outcome\)/);
  assert.match(ui, /const outcomeLine = detail\?\.lines\?\.find/);
  assert.match(ui, /`RDP\$\{progressive\}`/);
  assert.match(progressiveMigration, /workspace_production_rdp_number_seq/);
  assert.match(progressiveMigration, /rdp_number set not null/);
  assert.match(progressiveMigration, /unique index if not exists workspace_production_requests_rdp_number_uniq/);
  assert.match(ui, /RICALCOLA RDP/);
  assert.doesNotMatch(ui, /WorkspaceMES V3 · fabbisogni e produzione/);
  assert.doesNotMatch(ui, /La distinta prodotto finito Mexal sarà esplosa/);
  assert.match(productionCss, /\.rdp-v3-recalculate\s*\{[^}]*width:\s*100%[^}]*background:\s*#18b76a/);
  assert.match(ui, /DIRECT calcolati da Workspace, MP certificate da ProgreMES/);
  assert.doesNotMatch(ui, /Apri nel contesto/);
  assert.match(production, /RdP Workbench/);
});

test("RdP annullate restano nello storico e gli OCT tornano lavorabili", () => {
  assert.match(ui, /Storico RdP/);
  assert.match(ui, /payload\.history/);
  assert.match(ui, /row\.orderId \|\| row\.id/);
  assert.match(workbench, /!cancelled\(request\)/);
  assert.match(workbench, /history:\$\{request\.id\}/);
  assert.match(reopenMigration, /workspace_production_requests_active_idempotency_uniq/);
  assert.match(reopenMigration, /workspace_production_requests_active_first_line_uniq/);
  assert.match(reopenMigration, /<> 'CANCELLED'/);
  assert.match(reopenMigration, /pg_advisory_xact_lock/);
  assert.doesNotMatch(reopenMigration, /delete\s+from/i);
});

test("annullo RdP richiede permesso, motivo e conferma esplicita", () => {
  assert.match(api, /progremes_production_cancel[\s\S]*?rdp\.cancel/);
  assert.match(ui, /Annulla RdP/);
  assert.match(ui, /Motivo obbligatorio/);
  assert.match(ui, /Confermo di voler annullare logicamente/);
  assert.match(ui, /reason\.trim\(\)\.length >= 5/);
  assert.match(ui, /setCancelTarget\(null\);\s*setDetail\(null\);\s*setTab\("evaluation"\);\s*setSelected\(\[\]\);/);
  assert.match(cancellationMigration, /rdp\.cancel/);
  assert.match(legacyCancellationMigration, /AWAITINGDECISION/);
  assert.match(legacyCancellationMigration, /AWAITING_DECISION/);
});

test("annullo è logico, auditato e fail-closed sugli effetti produttivi", () => {
  assert.match(cancellationMigration, /set stato = 'Cancelled', workspace_status = 'Cancelled'/);
  assert.match(cancellationMigration, /workspace_production_request_audit/);
  assert.match(cancellationMigration, /on delete restrict/);
  assert.match(cancellationMigration, /IRREVERSIBLE_EFFECTS/);
  assert.match(cancellationMigration, /mes_production_order_id is not null/);
  assert.match(cancellationMigration, /confirmation_external_id is not null/);
  assert.match(cancellationMigration, /CANCELLED_PRODUCTION_REQUEST_IMMUTABLE/);
  assert.match(cancellationRefinementMigration, /MATERIAL\.\*\(CONSUMED\|MOVEMENT\)/);
  assert.doesNotMatch(cancellationRefinementMigration, /\|MATERIAL\|/);
  assert.doesNotMatch(cancellationMigration, /delete\s+from\s+public\.(workspace_production_requests|ordini_testate)/i);
});

test("preview, invio e decisione applicano permessi RdP dedicati", () => {
  assert.match(api, /progremes_production_preview[\s\S]*?rdp\.create/);
  assert.match(api, /progremes_production_request[\s\S]*?rdp\.create/);
  assert.match(api, /progremes_production_confirm[\s\S]*?rdp\.decide/);
  assert.match(api, /workspacemes_v3_preview[\s\S]*?rdp\.create/);
  assert.match(api, /workspacemes_v3_confirm[\s\S]*?rdp\.decide/);
  assert.match(api, /workspacemes_v3_purchase_document[\s\S]*?purchases\.manage/);
  assert.match(migration, /rdp\.create/);
  assert.match(api, /if \(!permissionCode && internalSecrets/);
});

test("preview V3 aggiorna prima i contratti Mexal autorevoli nel normale flusso", () => {
  assert.match(api, /case "workspacemes_v3_preview"[\s\S]*?workspaceV3FinishedArticleCodes[\s\S]*?syncWorkspaceV3MexalContracts\([\s\S]*?finishedArticleCodes[\s\S]*?createWorkspaceV3Preview\(/);
});

test("deep link conserva solo contesto MES allow-listed", () => {
  assert.equal(appendProgremesContext("/Planning", { rdpId: "rdp-1", octId: "oct-2", secret: "no" }), "/Planning?rdpId=rdp-1&octId=oct-2");
  assert.equal(appendProgremesContext("//evil.example", { rdpId: "x" }), "//evil.example");
});

test("UI impedisce doppio click e separa dati commerciali da analisi MES", () => {
  assert.match(ui, /if \(!sendEnabled \|\| !preview \|\| busy\) return/);
  assert.match(ui, /disabled=\{busy\}/);
  assert.match(ui, /Dati commerciali OCT/);
  assert.match(ui, /Analisi produttiva MES/);
  for (const field of ["PhysicalQuantity", "CommittedQuantity", "FreeQuantity", "MissingQuantity", "ProducibleQuantity", "PlannableQuantity", "BlockCode"]) assert.match(ui, new RegExp(field));
  assert.match(ui, /OCT MODIFICATO IN MEXAL/);
  assert.match(ui, /ULTIMO INVIO NON RIUSCITO/);
  assert.match(ui, /last_error_code/);
});

test("UI disabilita preview e Crea RdP quando il gate Production non è ON", () => {
  assert.match(ui, /productionGates\?\.allOn === true/);
  assert.match(ui, /disabled=\{busy \|\| !sendEnabled\}/);
  assert.match(ui, /Invio RdP Production non disponibile/);
  assert.match(production, /Invio RdP Workspace/);
  assert.match(production, /Gate Production/);
});

test("Workbench mostra la ragione sociale cliente e apre il dettaglio in un dialog visibile", () => {
  assert.match(workbench, /ordini_clienti_cache/);
  assert.match(workbench, /ragione_sociale/);
  assert.match(workbench, /customerName\(order, customersByCode\)/);
  assert.match(ui, /rdp-detail-backdrop/);
  assert.match(ui, /role="dialog"/);
  assert.match(ui, /aria-modal="true"/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("il modulo AI è protetto da catalogo, route e controllo server", async () => {
  const [migration, app, layout, server, vercel, automation] = await Promise.all([
    read("supabase/migrations/20260818220000_workspace_ai_module.sql"),
    read("src/App.jsx"),
    read("src/components/Layout.jsx"),
    read("server/ai/assistant.js"),
    read("vercel.json"),
    read("api/mexal/automation.js"),
  ]);
  assert.match(migration, /'assistente_ai'.*'Assistente AI'/s);
  assert.match(app, /WorkspaceAccessGuard moduleCode="assistente_ai"/);
  assert.match(layout, /module: "assistente_ai"/);
  assert.match(server, /capabilities\.module_access !== true/);
  assert.match(vercel, /"source": "\/api\/ai\/assistant"/);
  assert.match(automation, /handleAIAssistant/);
});

test("Web, ordini, ProgreMES e applicazione sono capacità indipendenti e chiuse per default", async () => {
  const migration = await read("supabase/migrations/20260818220000_workspace_ai_module.sql");
  assert.match(migration, /ricerca_web boolean not null default false/);
  assert.match(migration, /ordini boolean not null default false/);
  assert.match(migration, /progremes boolean not null default false/);
  assert.match(migration, /applicazione_piani boolean not null default false/);
  assert.match(migration, /workspace_ai_capabilities\(\)/);
});

test("l'amministratore Workspace ha accesso completo e la generazione ordini AI è disponibile a tutti gli utenti Ordini", async () => {
  const [assistant, orderDocument, governance, orders, dashboard] = await Promise.all([
    read("server/ai/assistant.js"),
    read("server/ai/order-document.js"),
    read("supabase/migrations/20260819100000_ai_vision_governance.sql"),
    read("src/modules/orders/pages/Orders.jsx"),
    read("src/modules/orders/pages/OrdersDashboard.jsx"),
  ]);
  assert.match(assistant, /workspaceAdmin = profile\.ruoli\?\.amministratore_workspace === true/);
  assert.match(assistant, /workspaceAdmin \|\| bypassAIEntitlements \? \{[\s\S]*module_access: true[\s\S]*web_search: true[\s\S]*apply_plans: true[\s\S]*vision: true/);
  assert.match(assistant, /monthly_cost_limit_usd: null/);
  assert.match(orderDocument, /bypassAIEntitlements: true/);
  assert.match(orderDocument, /auth\.access\?\.modules/);
  assert.doesNotMatch(orderDocument, /workspace_ai_module_access/);
  assert.match(orderDocument, /HARD_DAILY_DOCUMENT_LIMIT/);
  assert.match(orderDocument, /HARD_MAX_DOCUMENT_PAGES/);
  assert.match(orderDocument, /amministratore_workspace === true\) return/);
  assert.match(governance, /case when me\.is_admin then true/);
  for (const source of [orders, dashboard]) {
    assert.match(source, /Genera con AI/);
    assert.doesNotMatch(source, /aiOrderAllowed/);
    assert.doesNotMatch(source, /ai_order_capabilities/);
  }
});

test("i messaggi AI valorizzano sempre fonti e metadati obbligatori", async () => {
  const assistant = await read("server/ai/assistant.js");
  assert.match(assistant, /ruolo: "user", contenuto: prompt, fonti: \[\], metadati: safeUserMetadata/);
  assert.match(assistant, /fonti: safeSources, metadati: safeMetadata/);
});

test("l'assistente accetta documenti da allegato, trascinamento e fotocamera", async () => {
  const [assistant, assistantUi, attachments] = await Promise.all([
    read("server/ai/assistant.js"),
    read("src/pages/AIAssistant/AIAssistant.jsx"),
    read("src/pages/AIAssistant/assistantAttachments.js"),
  ]);
  assert.match(assistantUi, /> Allega</);
  assert.match(assistantUi, /> Fotocamera</);
  assert.match(assistantUi, /onDrop=/);
  assert.match(assistantUi, /capture="environment"/);
  assert.match(assistant, /capabilities\.vision !== true/);
  assert.match(assistant, /attachmentMetadata/);
  assert.match(attachments, /MAX_ASSISTANT_ATTACHMENTS = 4/);
  assert.match(attachments, /MAX_ASSISTANT_ATTACHMENT_BYTES = 2_800_000/);
});

test("l'assistente espone solo Dati interni e Ricerca Web e instrada automaticamente i piani", async () => {
  const assistantUi = await read("src/pages/AIAssistant/AIAssistant.jsx");
  const modes = assistantUi.slice(assistantUi.indexOf("const MODE_OPTIONS"), assistantUi.indexOf("function initialWelcome"));
  assert.match(modes, /label: "Dati interni"/);
  assert.match(modes, /label: "Ricerca Web"/);
  assert.doesNotMatch(modes, /label: "Ordini"|label: "Pianifica"|label: "Workspace \+ ProgreMES"/);
  assert.match(assistantUi, /isPlanningRequest\(requestText\)/);
  assert.match(assistantUi, /action: "proposal"[\s\S]*proposalType: inferredPlanType\(requestText\)/);
  assert.match(assistantUi, /Workspace \+ MES, piani, documenti e immagini/);
});

test("le conversazioni sono persistenti, riapribili e alimentano la memoria dell'assistente", async () => {
  const [assistant, assistantUi] = await Promise.all([
    read("server/ai/assistant.js"),
    read("src/pages/AIAssistant/AIAssistant.jsx"),
  ]);
  assert.match(assistant, /recentUserMemory/);
  assert.match(assistant, /previousUserRequests/);
  assert.match(assistant, /body\.action === "list_conversations"/);
  assert.match(assistant, /body\.action === "load_conversation"/);
  assert.match(assistantUi, /CRONOLOGIA/);
  assert.match(assistantUi, /action: "load_conversation"/);
  assert.match(assistantUi, /searchParams\.set\("conversation"/);
  assert.match(assistantUi, /requestedConversation \|\| recentConversations\[0\]\?\.id/);
  assert.match(assistantUi, /void openConversation\(initialConversationId\)/);
});

test("la cronologia AI è organizzata per argomenti e progetti con eliminazione manuale e pulizia a 60 giorni", async () => {
  const [migration, assistant, assistantUi, historyCss] = await Promise.all([
    read("supabase/migrations/20260820123000_ai_conversation_topics_and_retention.sql"),
    read("server/ai/assistant.js"),
    read("src/pages/AIAssistant/AIAssistant.jsx"),
    read("src/pages/AIAssistant/assistantHistory.css"),
  ]);
  assert.match(migration, /create table if not exists public\.ai_argomenti/);
  assert.match(migration, /tipo in \('argomento', 'progetto'\)/);
  assert.match(migration, /add column if not exists argomento_id/);
  assert.match(assistant, /CHAT_RETENTION_DAYS = 60/);
  assert.match(assistant, /body\.action === "delete_conversation"/);
  assert.match(assistant, /body\.action === "delete_stale_conversations"/);
  assert.match(assistant, /ai_conversazioni\.argomento_id/);
  assert.match(assistantUi, /CRONOLOGIA/);
  assert.match(assistantUi, /Nuovo argomento/);
  assert.match(assistantUi, /Nuovo progetto/);
  assert.match(assistantUi, /Cerca nelle conversazioni/);
  assert.match(assistantUi, /Conversazioni generali/);
  assert.match(assistantUi, /Nuova chat in questo gruppo/);
  assert.match(assistantUi, /workspaceConfirm/);
  assert.match(assistantUi, /più di \$\{retention\.days \|\| 60\} giorni/);
  assert.match(assistantUi, /Elimina chat/);
  assert.match(historyCss, /ai-delete-chat/);
});

test("l'assistente usa il dettaglio fatture e il fatturato netto per prodotto", async () => {
  const [assistant, migration] = await Promise.all([
    read("server/ai/assistant.js"),
    read("supabase/migrations/20260820110000_invoice_line_net_values_and_ai_context.sql"),
  ]);
assert.match(assistant, /workspace_ai_sales_invoice_context/);
assert.match(assistant, /l’interfaccia lo trasformerà in un vero file allegato/);
const assistantUi = await readFile("src/pages/AIAssistant/AIAssistant.jsx", "utf8");
assert.match(assistantUi, /ai-artifact-card/);
assert.match(assistantUi, /download=\{download\.fileName\}/);
assert.match(assistantUi, /isPdfReportRequest/);
assert.match(assistantUi, /payload\.downloadablePdf === true/);
assert.match(assistantUi, /message\.metadati\?\.artifacts/);
assert.match(assistant, /requestedArtifacts\(prompt, generationId\)/);
assert.match(assistant, /downloadablePdf, artifacts/);
  assert.match(assistant, /valore_netto delle righe/);
  assert.match(assistant, /workspace_ai_customer_reorder_context/);
  assert.match(assistant, /customerReorders/);
  assert.match(assistant, /cache Mexal sincronizzata/);
  assert.match(migration, /prodotti_per_fatturato_netto/);
  assert.match(migration, /righe_senza_valore_netto/);
  assert.match(migration, /security invoker/);
  const reorderMigration = await read("supabase/migrations/20260820115000_ai_customer_invoice_reorders.sql");
  assert.match(reorderMigration, /clienti_per_numero_fatture/);
  assert.match(reorderMigration, /riordino completo/);
  assert.match(reorderMigration, /riordino parziale/);
  assert.match(reorderMigration, /nessun prodotto ripetuto/);
  assert.match(reorderMigration, /sum\(r\.valore_netto\)/);
});

test("la pianificazione richiede approvazione e non applica ProgreMES senza connettore", async () => {
  const server = await read("server/ai/assistant.js");
  assert.match(server, /PROGREMES_AI_PLANNING_ENABLED/);
  assert.match(server, /connectorRequired: true/);
  assert.match(server, /Approvazione dei piani non autorizzata/);
  assert.match(server, /proposal\.stato !== "bozza"/);
  assert.doesNotMatch(server, /from\("ordini_testate"\)\.update/);
});

test("l'autoapprendimento dei tempi usa consuntivi ProgreMES e resta soggetto ad approvazione", async () => {
  const [server, assistantUi, documentation, cron, vercel] = await Promise.all([
    read("server/ai/assistant.js"),
    read("src/pages/AIAssistant/AIAssistant.jsx"),
    read("docs/ASSISTENTE_AI.md"),
    read("api/cron/mexal-dispatcher.js"),
    read("vercel.json"),
  ]);
  assert.match(server, /production_time_revision/);
  assert.match(server, /candidate\.sampleCount/);
  assert.match(server, /evidenceSignature/);
  assert.match(server, /time_learning_review/);
  assert.match(server, /learningFingerprint/);
  assert.match(server, /runAutomaticTimeLearningScan/);
  assert.match(server, /list_autoplanning/);
  assert.match(server, /Le produzioni iniziate o concluse non vengono modificate/);
  assert.match(assistantUi, /autoapprend/);
  assert.match(assistantUi, /AUTOPROGRAMMAZIONE/);
  assert.match(assistantUi, /pendingAutoPlanningCount/);
  assert.match(assistantUi, /action: "list_autoplanning"/);
  assert.doesNotMatch(assistantUi, /action: "time_learning_review"/);
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /runAutomaticTimeLearningScan/);
  assert.match(cron, /autoplanning/);
  assert.doesNotMatch(vercel, /api\/cron\/ai-time-learning/);
  assert.match(documentation, /timeLearning\.candidates/);
  assert.match(documentation, /tempi netti con fermate escluse/);
});

test("ogni utilizzo AI è rendicontato per utente con token e costo Gateway", async () => {
  const [migration, server, settings] = await Promise.all([
    read("supabase/migrations/20260818230000_workspace_ai_cost_reporting.sql"),
    read("server/ai/assistant.js"),
    read("src/pages/Settings/AISettings.jsx"),
  ]);
  assert.match(migration, /create table if not exists public\.ai_generazioni/);
  assert.match(migration, /costo_usd numeric\(14,8\)/);
  assert.match(migration, /workspace_record_ai_usage/);
  assert.match(migration, /admins read all AI usage/);
  assert.match(server, /providerMetadata\?\.gateway\?\.cost/);
  assert.match(server, /user: profileId/);
  assert.match(server, /startGeneration/);
  assert.match(server, /completeGeneration/);
  assert.match(settings, /Rendicontazione AI per utente/);
  assert.match(settings, /Costi effettivi comunicati da AI Gateway/);
  assert.match(settings, /Attiva modulo AI/);
  assert.match(settings, /from\("reparti_moduli"\)\.upsert/);
});

test("la governance AI gestisce immagini, livelli per modulo, budget ed eccezioni utente", async () => {
  const [migration, settings, server] = await Promise.all([
    read("supabase/migrations/20260819100000_ai_vision_governance.sql"),
    read("src/pages/Settings/AISettings.jsx"),
    read("server/ai/assistant.js"),
  ]);
  assert.match(migration, /riconoscimento_immagini boolean not null default false/);
  assert.match(migration, /create table if not exists public\.ai_reparti_moduli/);
  assert.match(migration, /create table if not exists public\.ai_utenti_moduli/);
  assert.match(migration, /admin_ai_effective_access/);
  assert.match(migration, /cost_limit_exceeded/);
  assert.match(settings, /Autorizzazioni per modulo/);
  assert.match(settings, /Verifica accesso utente/);
  assert.match(settings, /Budget reparto USD/);
  assert.match(settings, /Eccezione personale/);
  assert.match(server, /Limite mensile di spesa AI raggiunto/);
});

test("il livello operativo AI appartiene al ruolo e i moduli sono solo consentiti o bloccati", async () => {
  const [migration, accessRules, aiSettings, accessUsers, server] = await Promise.all([
    read("supabase/migrations/20260821130000_role_ai_level_and_boolean_module_access.sql"),
    read("src/pages/Settings/AccessRules.jsx"),
    read("src/pages/Settings/AISettings.jsx"),
    read("src/pages/Settings/AccessUsers.jsx"),
    read("server/ai/assistant.js"),
  ]);
  assert.match(migration, /add column if not exists livello_ai text/);
  assert.match(migration, /livello_ai in \('nessuno','analisi','bozza','conferma'\)/);
  assert.match(migration, /ai_reparti_moduli[\s\S]*consentito boolean not null default false/);
  assert.match(migration, /ai_utenti_moduli[\s\S]*consentito boolean/);
  assert.match(migration, /role_ai_level in \('bozza','conferma'\)/);
  assert.match(migration, /role_ai_level='conferma'/);
  assert.match(accessRules, /Livello AI/);
  assert.match(accessRules, /Esegui dopo conferma/);
  assert.match(aiSettings, /Il livello operativo AI dipende dal ruolo/);
  assert.match(aiSettings, /modulePolicy\.consentito/);
  assert.doesNotMatch(aiSettings, /<th>Livello AI<\/th>/);
  assert.match(accessUsers, /Eredita dal reparto/);
  assert.match(accessUsers, /consentito: value\.consentito/);
  assert.doesNotMatch(accessUsers, /const AI_LEVELS/);
  assert.match(server, /allowedAIModules/);
  assert.match(server, /capabilities\.orders &&/);
});
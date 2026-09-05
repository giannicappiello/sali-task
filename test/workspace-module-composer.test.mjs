import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the unified catalog stores screens and module composition", async () => {
  const migration = await read("supabase/migrations/20260818190000_unified_workspace_module_composer.sql");
  assert.match(migration, /create table if not exists public\.workspace_schermate/i);
  assert.match(migration, /create table if not exists public\.workspace_moduli_schermate/i);
  assert.match(migration, /protect_workspace_modules/i);
  assert.match(migration, /protect_last_workspace_screen_link/i);
  assert.match(migration, /foreign key \(modulo\) references public\.workspace_moduli/i);
});

test("module management lives under Settings", async () => {
  const [app, settingsHub, editor] = await Promise.all([
    read("src/App.jsx"),
    read("src/pages/Settings/SettingsHub.jsx"),
    read("src/pages/Settings/ModuleManagement.jsx"),
  ]);
  assert.match(app, /settings\/modules/);
  assert.match(settingsHub, /"\/settings\/modules"/);
  assert.match(settingsHub, /nome: "Utenti e accessi"/);
  assert.match(editor, /Mostra nel menu agli utenti autorizzati/);
  assert.match(editor, /Moduli e schermate/);
  assert.match(editor, /workspace_moduli_schermate/);
});

test("protected screens can be moved while their final module link remains protected", async () => {
  const editor = await read("src/pages/Settings/ModuleManagement.jsx");
  assert.match(editor, /screenLinks\.length === 1/);
  assert.match(editor, /screen\.protetta && isCurrentLink && screenLinks\.length === 1/);
  assert.match(editor, /ultimo collegamento protetto/);
  assert.doesNotMatch(editor, /protectedCanonicalLink/);
});

test("Settings and production are catalog-driven container modules", async () => {
  const [migration, settingsHub, production, productionService, layout] = await Promise.all([
    read("supabase/migrations/20260819190000_settings_and_production_hubs.sql"),
    read("src/pages/Settings/SettingsHub.jsx"),
    read("src/pages/Production/Production.jsx"),
    read("server/progremes-sso.js"),
    read("src/components/Layout.jsx"),
  ]);
  assert.match(migration, /'impostazioni'.*'contenitore'.*'\/settings'/s);
  assert.match(migration, /'progremes'.*schermata_codice/s);
  assert.match(migration, /existing_protected.*existing_type='contenitore'/s);
  assert.match(settingsHub, /eq\("modulo_codice", "impostazioni"\)/);
  assert.match(settingsHub, /ModuleContainerLayout/);
  assert.match(production, /ModuleContainerLayout/);
  assert.match(layout, /!withProduction\.some\(\(item\) => item\.module === "impostazioni"\)/);
  assert.match(layout, /item\.label\?\.trim\(\)\.toLocaleLowerCase\("it-IT"\) !== "impostazioni"/);
  assert.doesNotMatch(layout, /isAdminUser && teamItem/);
  assert.match(productionService, /eq\("modulo_codice", "progremes"\)/);
  assert.match(layout, /module: "impostazioni"/);
});

test("named Workspace administrators always receive complete module access", async () => {
  const [auth, migration] = await Promise.all([
    read("src/contexts/AuthContext.jsx"),
    read("supabase/migrations/20260819220000_ensure_named_admin_full_workspace_access.sql"),
  ]);
  assert.match(auth, /WORKSPACE_ADMIN_ROLE_NAMES/);
  assert.match(auth, /workspaceRoleIsAdmin\(profile\?\.ruoli\)/);
  assert.match(migration, /amministratore_workspace = true/);
  assert.match(migration, /lower\(btrim\(coalesce\(nome, ''\)\)\) = 'admin'/);
  assert.doesNotMatch(migration, /create trigger/i);
});

test("modules can be active without associated screens", async () => {
  const [editor, migration, containerMigration, nullDefaultFix, app, container] = await Promise.all([
    read("src/pages/Settings/ModuleManagement.jsx"),
    read("supabase/migrations/20260819170000_modules_without_screens.sql"),
    read("supabase/migrations/20260819193000_optional_default_screen_containers.sql"),
    read("supabase/migrations/20260819201000_fix_null_default_workspace_screen.sql"),
    read("src/App.jsx"),
    read("src/pages/Modules/WorkspaceModuleContainer.jsx"),
  ]);
  assert.doesNotMatch(editor, /Il modulo deve contenere almeno una schermata/);
  assert.match(editor, /target_default_screen: form\.predefinita \|\| null/);
  assert.match(editor, /Nessuna schermata iniziale/);
  assert.match(editor, /defaultScreen\?\.percorso \|\| `\/moduli\/\$\{code\}`/);
  assert.match(editor, /sono facoltative/);
  assert.match(migration, /normalized_screen_codes text\[\].*array\[\]::text\[\]/s);
  assert.match(migration, /target_default_screen := null/);
  assert.match(migration, /'\/moduli\/' \|\| target_code/);
  assert.doesNotMatch(migration, /deve contenere almeno una schermata/);
  assert.match(containerMigration, /target_type := 'contenitore'/);
  assert.match(containerMigration, /target_default_screen is not null and target_default_screen=any\(normalized_screen_codes\)/);
  assert.match(nullDefaultFix, /coalesce\(code=target_default_screen,false\)/);
  assert.match(app, /moduli\/:moduleCode/);
  assert.match(container, /ModuleContainerLayout/);
  assert.match(container, /workspace_moduli_schermate/);
});

test("all container modules share the production layout", async () => {
  const [sharedLayout, genericContainer, settingsHub, production, analyticsHub] = await Promise.all([
    read("src/components/ModuleContainerLayout.jsx"),
    read("src/pages/Modules/WorkspaceModuleContainer.jsx"),
    read("src/pages/Settings/SettingsHub.jsx"),
    read("src/pages/Production/Production.jsx"),
    read("src/modules/analytics/pages/AnalyticsHub.jsx"),
  ]);
  assert.match(sharedLayout, /module-container-grid/);
  assert.match(genericContainer, /ModuleContainerLayout/);
  assert.match(settingsHub, /ModuleContainerLayout/);
  assert.match(production, /ModuleContainerLayout/);
  assert.match(analyticsHub, /ModuleContainerLayout/);
});

test("home cards reuse the exact visible menu entries", async () => {
  const [layout, home, homeMigration] = await Promise.all([
    read("src/components/Layout.jsx"),
    read("src/pages/Home/Home.jsx"),
    read("supabase/migrations/20260819210000_home_as_workspace_container.sql"),
  ]);
  assert.match(layout, /<Outlet context=\{visibleMenuItems\} \/>/);
  assert.match(home, /useOutletContext/);
  assert.match(home, /ModuleContainerLayout/);
  assert.match(home, /\.filter\(\(item\) => item\.path !== "\/home"\)/);
  assert.match(homeMigration, /set tipo = 'contenitore'/);
  assert.doesNotMatch(home, /const cards = \[/);
  assert.doesNotMatch(home, /integrazioni_utenti/);
});

test("all workspace screens use the shared Modules and screens presentation", async () => {
  const [layout, screenLayout, styles, aiSettings] = await Promise.all([
    read("src/components/Layout.jsx"),
    read("src/components/WorkspaceScreenLayout.jsx"),
    read("src/components/workspace-screen-layout.css"),
    read("src/pages/Settings/AISettings.jsx"),
  ]);
  assert.match(layout, /WorkspaceScreenLayout/);
  assert.match(screenLayout, /SCHERMATA WORKSPACE/);
  assert.match(screenLayout, /workspace_moduli_schermate/);
  assert.match(screenLayout, /predefinita/);
  assert.match(screenLayout, /exactModule\?\.tipo === "contenitore" && !exactScreen/);
  assert.doesNotMatch(screenLayout, /defaultModuleScreen/);
  assert.match(screenLayout, /BUILT_IN_CONTAINER_PATHS/);
  assert.match(styles, /linear-gradient\(135deg,#102a56,#1b5aaa\)/);
  assert.match(styles, /\.workspace-screen-content \.page-title-row \{ display: none; \}/);
  assert.doesNotMatch(aiSettings, /className="ai-settings-header"/);
});

test("Team remains visible in the sidebar when it is visible in Home", async () => {
  const [app, layout, hiddenNavigation] = await Promise.all([
    read("src/App.jsx"),
    read("src/components/Layout.jsx"),
    read("src/styles/team-navigation-hidden.css").catch(() => ""),
  ]);
  assert.doesNotMatch(app, /team-navigation-hidden\.css/);
  assert.match(layout, /\.eq\("attivo", true\)/);
  assert.match(layout, /\.eq\("mostra_menu", true\)/);
  assert.doesNotMatch(layout, /isAdminUser && teamItem/);
  assert.equal(hiddenNavigation, "");
});

test("ProgreMES integration remains a synchronization service", async () => {
  const [settings, service] = await Promise.all([
    read("src/modules/integrations/pages/ProgremesSettings.jsx"),
    read("server/progremes-modules.js"),
  ]);
  assert.match(settings, /La composizione dei moduli e delle schermate si gestisce in Impostazioni → Moduli/);
  assert.match(service, /workspace_schermate/);
  assert.match(service, /provider: "progremes"/);
});

test("existing ProgreMES modules are backfilled into the screen catalog", async () => {
  const migration = await read("supabase/migrations/20260818203000_backfill_progremes_screens.sql");
  assert.match(migration, /insert into public\.workspace_schermate/);
  assert.match(migration, /from public\.progremes_moduli/);
  assert.match(migration, /'progremes\.' \|\| modulo\.codice/);
  assert.match(migration, /existing_progremes_modules/);
});

test("Beauty Days is composed of three independently configurable screens", async () => {
  const [migration, module, styles, dashboard, contacts, days] = await Promise.all([
    read("supabase/migrations/20260819234000_beauty_days_three_screens.sql"),
    read("src/modules/pharmacy/PharmacyModule.jsx"),
    read("src/modules/pharmacy/pharmacy-module.css"),
    read("src/modules/pharmacy/pages/Dashboard.jsx"),
    read("src/modules/pharmacy/pages/ApertureContatti.jsx"),
    read("src/modules/pharmacy/pages/Giornate.jsx"),
  ]);
  assert.match(migration, /'beauty\.dashboard'/);
  assert.match(migration, /'beauty\.aperture'/);
  assert.match(migration, /'beauty\.giornate'/);
  assert.match(migration, /'beauty_days', 'beauty\.dashboard', 10, true/);
  assert.match(migration, /'beauty_days', 'beauty\.aperture', 20, false/);
  assert.match(migration, /'beauty_days', 'beauty\.giornate', 30, false/);
  assert.match(module, /path="dashboard"/);
  assert.match(module, /path="aperture"/);
  assert.match(module, /path="giornate"/);
  assert.doesNotMatch(module, /pharmacy-module-header/);
  assert.doesNotMatch(module, /pharmacy-access-badge/);
  assert.doesNotMatch(styles, /\.pharmacy-module-header/);
  assert.doesNotMatch(dashboard, /<h2>Dashboard<\/h2>/);
  assert.doesNotMatch(contacts, /<h2>Aperture \/ Contatti<\/h2>/);
  assert.match(days, /\(mostraForm \|\| giornataDettaglio\)/);
});

test("ProgreMES production orders are composed of four independently configurable screens", async () => {
  const [migration, sso] = await Promise.all([
    read("supabase/migrations/20260819243000_progremes_production_orders_screens.sql"),
    read("server/progremes-sso.js"),
  ]);
  for (const code of [
    "progremes.Ordini.Preventivo",
    "progremes.Ordini.Cliente",
    "progremes.Ordini.Produzione",
    "progremes.Ordini.Fabbisogni",
  ]) {
    assert.match(migration, new RegExp(`'${code.replaceAll(".", "\\.")}'`));
  }
  assert.match(migration, /'progremes_ordini', 'progremes\.Ordini\.Preventivo', 10, false, true/);
  assert.match(migration, /'progremes_ordini', 'progremes\.Ordini\.Fabbisogni', 40, false, true/);
  assert.match(migration, /tipo = 'contenitore'/);
  assert.match(migration, /percorso = '\/moduli\/progremes_ordini'/);
  assert.match(migration, /external_code.*Ordini/);
  assert.doesNotMatch(sso, /select\("schermata_codice"\)\s*\.eq\("modulo_codice", "progremes"\)\s*\.eq\("schermata_codice", screenCode\)/);
  assert.match(sso, /linkedModuleCodes/);
  assert.match(sso, /linkedModuleCodes/);
  assert.match(sso, /in\("codice", linkedModuleCodes\)\.eq\("attivo", true\)/);
  assert.doesNotMatch(sso, /in\("codice", linkedModuleCodes\)\.eq\("provider", "progremes"\)/);
});

test("ProgreMES calendar and documents are exposed with their real screen composition", async () => {
  const migration = await read("supabase/migrations/20260819245000_progremes_calendar_documents_screens.sql");

  assert.match(migration, /'progremes\.Planning\.CalendarioAziendale'/);
  assert.match(migration, /"external_route":"\/impostazioni\/calendario"/);
  assert.match(migration, /'impostazioni','progremes\.Planning\.CalendarioAziendale',80,false,true/);

  for (const code of [
    "progremes.Formule.CoaProduzioni",
    "progremes.Formule.CoaArticoli",
    "progremes.Formule.Pif",
    "progremes.Formule.SchedeTecniche",
    "progremes.Formule.SchedeSicurezza",
  ]) {
    assert.match(migration, new RegExp(`'${code.replaceAll(".", "\\.")}'`));
  }
  assert.match(migration, /'progremes_formule',[\s\S]*?'Documenti'/);
  assert.match(migration, /'progremes_formule','progremes\.Formule\.CoaProduzioni',10,false,true/);
  assert.match(migration, /'progremes_formule','progremes\.Formule\.SchedeSicurezza',50,false,true/);
  assert.match(migration, /is_documents_module boolean := lower\(btrim\(new\.codice\)\) = 'formule'/);
  assert.match(migration, /delete from public\.workspace_moduli_schermate[\s\S]*schermata_codice='progremes\.Formule'/);
});

test("Integrations is composed of independently configurable operational screens", async () => {
  const [migration, dashboard] = await Promise.all([
    read("supabase/migrations/20260819244000_integration_module_screens.sql"),
    read("src/modules/integrations/pages/IntegrationsDashboard.jsx"),
  ]);
  for (const code of [
    "integrazioni.mexal",
    "integrazioni.mexal_agenti",
    "integrazioni.serie_documenti",
    "integrazioni.ordini_pr",
    "integrazioni.ordini_ph",
    "integrazioni.documentale",
    "integrazioni.progremes",
  ]) {
    assert.match(migration, new RegExp(`'${code.replaceAll(".", "\\.")}'`));
  }
  assert.match(migration, /set tipo='contenitore'/);
  assert.match(migration, /'integrazioni','integrazioni\.mexal',10,false,true/);
  assert.match(migration, /'integrazioni','integrazioni\.progremes',70,false,true/);
  assert.match(dashboard, /workspace_moduli_schermate/);
  assert.match(dashboard, /required_permissions/);
  assert.match(dashboard, /ModuleContainerLayout/);
  assert.doesNotMatch(dashboard, /IntegrationCard/);
});

test("PR and PH order modules expose their operational areas as configurable screens", async () => {
  const migration = await read("supabase/migrations/20260819240000_order_module_screens.sql");
  for (const code of [
    "ordini_pr.dashboard",
    "ordini_pr.clienti",
    "ordini_pr.ordini",
    "ordini_pr.fatture",
    "ordini_ph.dashboard",
    "ordini_ph.clienti",
    "ordini_ph.ordini",
    "ordini_ph.fatture",
  ]) {
    assert.match(migration, new RegExp(`'${code.replace(".", "\\.")}'`));
  }
  assert.match(migration, /'ordini_pr', 'ordini_pr\.dashboard', 10, false, true/);
  assert.match(migration, /'ordini_ph', 'ordini_ph\.dashboard', 10, false, true/);
  assert.match(migration, /predefinita = workspace_moduli_schermate\.predefinita/);
  assert.match(migration, /tipo = 'contenitore'/);
  assert.match(migration, /and links\.predefinita/);
});

test("order dashboards do not repeat the module screen navigation", async () => {
  const [module, migration] = await Promise.all([
    read("src/modules/orders/OrdersModule.jsx"),
    read("supabase/migrations/20260819241000_order_modules_as_containers.sql"),
  ]);
  assert.doesNotMatch(module, /orders-tabs/);
  assert.doesNotMatch(module, /orders-module-header/);
  assert.doesNotMatch(module, /NavLink/);
  assert.match(migration, /set predefinita = false/);
  assert.match(migration, /where modulo_codice in \('ordini_pr', 'ordini_ph'\)/);
  assert.match(migration, /tipo = 'contenitore'/);
  assert.match(migration, /percorso = '\/moduli\/' \|\| codice/);
});

test("department and role editors consume the dynamic module catalog", async () => {
  const settings = await read("src/pages/Settings/Settings.jsx");
  assert.match(settings, /from\("workspace_moduli"\)/);
  assert.match(settings, /moduleCatalog\.filter\(\(module\) => module\.attivo && module\.assegnabile_reparto\)/);
  assert.match(settings, /moduleCatalog\.filter\(\(module\) => module\.attivo && module\.configurabile_ruolo\)/);
});

test("workspace screens never render a global available-screens card", async () => {
  const [layout, removedRenderer, removedStyles, sso, automation] = await Promise.all([
    read("src/components/Layout.jsx"),
    read("src/components/ConfiguredModuleScreens.jsx").catch(() => ""),
    read("src/components/configured-module-screens.css").catch(() => ""),
    read("server/progremes-sso.js"),
    read("api/mexal/automation.js"),
  ]);
  assert.doesNotMatch(layout, /ConfiguredModuleScreens/);
  assert.equal(removedRenderer, "");
  assert.equal(removedStyles, "");
  assert.match(sso, /Schermata ProgreMES non autorizzata/);
  assert.match(sso, /progremes_reparti_moduli/);
  assert.match(automation, /issueProgremesTicket\(req, body\)/);
});

test("the analytics topic screen is the default and its cards follow module composition", async () => {
  const [migration, hub] = await Promise.all([
    read("supabase/migrations/20260819090000_workspace_topic_screens.sql"),
    read("src/modules/analytics/pages/AnalyticsHub.jsx"),
  ]);
  assert.match(migration, /'analisi\.hub'.*'\/analisi-dati'.*'analytics\.hub'/s);
  assert.match(migration, /set predefinita=false/);
  assert.match(migration, /'analisi_dati','analisi\.hub',0,true,false/);
  assert.match(hub, /from\("workspace_moduli_schermate"\)/);
  assert.match(hub, /eq\("modulo_codice", "analisi_dati"\)/);
  assert.match(hub, /workspace:module-catalog-changed/);
});

test("legacy and derived module rows are migrated into canonical modules before removal", async () => {
  const migration = await read("supabase/migrations/20260819235000_cleanup_legacy_and_derived_modules.sql");
  for (const code of ["agenda", "progetti", "report", "analisi_attivita", "analisi_fatture", "analisi_ordini_ph", "analisi_beauty_days"]) {
    assert.match(migration, new RegExp(`'${code}'`));
  }
  assert.match(migration, /insert into public\.reparti_moduli/);
  assert.match(migration, /insert into public\.ruoli_moduli/);
  assert.match(migration, /insert into public\.ai_reparti_moduli/);
  assert.match(migration, /insert into public\.ai_utenti_moduli/);
  assert.match(migration, /delete from public\.workspace_moduli/);
  assert.match(migration, /jsonb_build_object\('source_module'/);
});

test("screen order is configurable per module and drives every module presentation", async () => {
  const [editor, orderHook, activities, beauty, genericContainer, settingsHub, analyticsHub, productionService] = await Promise.all([
    read("src/pages/Settings/ModuleManagement.jsx"),
    read("src/hooks/useOrderedModuleScreens.js"),
    read("src/pages/Activities/ActivitiesModule.jsx"),
    read("src/modules/pharmacy/PharmacyModule.jsx"),
    read("src/pages/Modules/WorkspaceModuleContainer.jsx"),
    read("src/pages/Settings/SettingsHub.jsx"),
    read("src/modules/analytics/pages/AnalyticsHub.jsx"),
    read("server/progremes-sso.js"),
  ]);
  assert.match(editor, /moveScreenToPosition/);
  assert.match(editor, /sortModulePickerScreens/);
  assert.match(editor, /moduleOrder\.get\(left\.codice\)/);
  assert.match(editor, /return leftOrder - rightOrder/);
  assert.match(editor, /Ordine nel modulo/);
  assert.match(editor, /target_screen_codes: form\.schermate/);
  assert.match(editor, /Ordine nel catalogo/);
  assert.match(orderHook, /workspace_moduli_schermate/);
  assert.match(orderHook, /\.order\("ordine"\)/);
  assert.match(activities, /useOrderedModuleScreens\("attivita", items\)/);
  assert.match(beauty, /useOrderedModuleScreens\("beauty_days", items\)/);
  assert.match(genericContainer, /\.order\("ordine"\)/);
  assert.match(settingsHub, /\.order\("ordine"\)/);
  assert.match(analyticsHub, /\.order\("ordine"\)/);
  assert.match(productionService, /select\("schermata_codice,ordine"\)/);
  assert.match(productionService, /moduleOrder: link\.ordine/);
});

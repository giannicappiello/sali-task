import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CRM_ROUTE_CATALOG } from "../../src/modules/crm/crmRouteCatalog.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const crm = read("src/modules/crm/CrmModule.jsx");
const digital = read("src/modules/crm/DigitalCommerce.jsx");
const ai = read("src/modules/crm/CrmAIBrief.jsx");
const settings = read("src/pages/Settings/DigitalConnectionsSettings.jsx");
const integration = read("src/modules/integrations/pages/DigitalIntegrationStatus.jsx");
const structureCss = read("src/modules/crm/crm.css");
const workspaceCss = read("src/modules/crm/workspace-alignment.css");
const classificationCss = read("src/modules/crm/customer-classification.css");

test("tutte le 25 destinazioni CRM passano dal layout e dalla guardia Workspace", () => {
  assert.equal(CRM_ROUTE_CATALOG.length, 25);
  assert.match(crm, /CRM_ROUTE_CATALOG\.map/);
  assert.match(crm, /return <Screen moduleCode=\{route\.moduleCode\} screenCode=\{route\.screenCode\}>/);
  assert.match(crm, /WorkspaceAccessGuard/);
  for (const route of CRM_ROUTE_CATALOG) {
    assert.ok(route.catalogPath.startsWith("/crm"));
    assert.ok(route.moduleCode);
    assert.ok(route.screenCode);
  }
});

test("dashboard, tabelle, pannelli e azioni riusano le classi standard Workspace", () => {
  assert.match(crm, /className="kpi-card crm-kpi"/);
  assert.match(crm, /className="panel crm-panel"/);
  assert.match(crm, /className="primary-action crm-primary"/);
  assert.match(crm, /className="secondary-action crm-secondary"/);
  assert.match(digital, /className="panel crm-panel"/);
  assert.match(settings, /className="panel crm-panel/);
  assert.match(integration, /className="panel crm-panel/);
});

test("Connection Manager, Integration Status e AI condividono la stessa gabbia CRM Workspace", () => {
  assert.match(settings, /workspace-alignment\.css/);
  assert.match(integration, /workspace-alignment\.css/);
  assert.match(crm, /workspace-alignment\.css/);
  assert.match(ai, /crm-ai-shell/);
  assert.match(workspaceCss, /\.crm-ai-main/);
  assert.doesNotMatch(`${crm}${digital}${ai}${settings}${integration}`, /[😀-🙏]/u);
});

test("azioni, tabelle, modali e contenuto restano raggiungibili fino a 390px", () => {
  for (const breakpoint of [1280, 1024, 768, 640, 390]) {
    assert.match(workspaceCss, new RegExp(`@media\\(max-width:${breakpoint}px\\)`));
  }
  assert.match(workspaceCss, /\.crm-toolbar>button[^}]*width:100%/);
  assert.match(workspaceCss, /\.crm-table-wrap[^}]*overflow-x:auto/);
  assert.match(workspaceCss, /max-height:calc\(100dvh - 20px\)/);
  assert.match(structureCss, /\.crm-kanban[^}]*overflow:auto/);
  assert.match(classificationCss, /@media\(max-width:640px\)/);
});

test("la Panoramica include la dashboard globale clienti senza introdurre una nuova route", () => {
  assert.match(crm, /<CommercialControlDashboard scope="global" embedded \/>/);
  assert.doesNotMatch(CRM_ROUTE_CATALOG.map((route) => route.catalogPath).join("\n"), /classificazione/);
  assert.match(crm, /\/creators/);
  assert.match(crm, /\/journey/);
  assert.doesNotMatch(crm, /basePath}\/creator`/);
  assert.doesNotMatch(crm, /basePath}\/customer-journey`/);
});

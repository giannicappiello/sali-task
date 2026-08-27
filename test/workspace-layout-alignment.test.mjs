import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("containers and screens render the same single Workspace page header", async () => {
  const [header, container, screen, screenStyles, home] = await Promise.all([
    read("src/components/WorkspacePageHeader.jsx"),
    read("src/components/ModuleContainerLayout.jsx"),
    read("src/components/WorkspaceScreenLayout.jsx"),
    read("src/components/workspace-screen-layout.css"),
    read("src/pages/Home/Home.jsx"),
  ]);
  assert.match(container, /useBackNavigation\(backFallback\)/);
  assert.match(container, /<WorkspacePageHeader/);
  assert.match(screen, /<WorkspacePageHeader/);
  assert.equal((header.match(/<h1>/g) || []).length, 1);
  assert.doesNotMatch(container, /<h1>/);
  assert.doesNotMatch(screen, /<h1>/);
  assert.match(screenStyles, /\.workspace-page-header\s*\{[^}]*min-height:\s*228px;[^}]*padding:\s*34px;/s);
  assert.match(screenStyles, /\.workspace-page-header-back\s*\{[^}]*align-items:\s*center;[^}]*gap:\s*12px;[^}]*line-height:\s*1;/s);
  assert.match(home, /showBack=\{false\}/);
});

test("specialist content headers are reduced to toolbars below the shared header", async () => {
  const styles = await read("src/components/workspace-screen-layout.css");
  assert.match(styles, /\.workspace-screen-content \.crm-page-header-copy/);
  assert.match(styles, /\.workspace-screen-content \.documentation-hero/);
  assert.match(styles, /\.workspace-screen-content \.orders-new-header/);
  assert.match(styles, /\.workspace-screen-content \.crm-toolbar > :first-child:has\(> h2\)/);
  assert.match(styles, /\.workspace-screen-content \.progremes-summary-title/);
  assert.match(styles, /\.workspace-screen-content \.rdp-header > :first-child/);
  assert.match(styles, /\.workspace-screen-content \.commercial-analysis-fullscreen/);
});

test("CRM dashboards sharing a module route render as standard Workspace screens", async () => {
  const screen = await read("src/components/WorkspaceScreenLayout.jsx");
  assert.match(screen, /exactModule\?\.tipo === "contenitore" && !exactScreen/);
  assert.match(screen, /\(\?:menu\|moduli\)/);
  assert.match(screen, /"\/integrations"/);
  assert.match(screen, /"\/crm\/online"/);
  assert.match(screen, /const navigationParent = parentModule\?\.percorso/);
  assert.doesNotMatch(screen, /defaultModuleScreen/);
});

test("production detail screens delegate the only back control to the shared Workspace header", async () => {
  const [layout, production, workbench] = await Promise.all([
    read("src/components/Layout.jsx"),
    read("src/pages/Production/Production.jsx"),
    read("src/pages/Production/RdpWorkbench.jsx"),
  ]);
  assert.match(layout, /"\/produzione\/diagnostica": \{ title: "Centro Diagnostico"/);
  assert.match(layout, /"\/produzione\/rdp-workbench": \{ title: "Gestione Produzione"/);
  assert.doesNotMatch(production, /className="diagnostics-back"/);
  assert.doesNotMatch(workbench, /className="diagnostics-back"/);
});

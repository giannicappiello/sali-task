import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Workspace headers expose consistently aligned keyboard-accessible back navigation", async () => {
  const [container, containerStyles, screen, screenStyles, home] = await Promise.all([
    read("src/components/ModuleContainerLayout.jsx"),
    read("src/components/module-container-layout.css"),
    read("src/components/WorkspaceScreenLayout.jsx"),
    read("src/components/workspace-screen-layout.css"),
    read("src/pages/Home/Home.jsx"),
  ]);
  assert.match(container, /useBackNavigation\(backFallback\)/);
  assert.match(container, /className="module-container-back"/);
  assert.match(containerStyles, /\.module-container-back\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*12px;[^}]*line-height:\s*1;/s);
  assert.match(screen, /className="workspace-screen-back"/);
  assert.match(screenStyles, /\.workspace-screen-back\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*12px;[^}]*line-height:\s*1;/s);
  assert.match(home, /showBack=\{false\}/);
});

test("CRM dashboards sharing a module route render as standard Workspace screens", async () => {
  const screen = await read("src/components/WorkspaceScreenLayout.jsx");
  assert.match(screen, /exactModule\?\.tipo === "contenitore" && !exactScreen/);
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("page-level back controls use browser history with a safe fallback", async () => {
  const hook = await read("src/hooks/useBackNavigation.js");
  assert.match(hook, /window\.history\.state\?\.idx/);
  assert.match(hook, /navigate\(-1\)/);
  assert.match(hook, /navigate\(fallbackPath, \{ replace: true \}\)/);
});

test("workspace, settings, analytics and detail pages share back navigation", async () => {
  const files = await Promise.all([
    read("src/components/WorkspaceScreenLayout.jsx"),
    read("src/pages/Settings/Settings.jsx"),
    read("src/pages/Settings/ModuleManagement.jsx"),
    read("src/pages/Settings/MexalDiagnostics.jsx"),
    read("src/modules/analytics/pages/CommercialPivotAnalysis.jsx"),
    read("src/modules/orders/pages/CustomerDetail.jsx"),
    read("src/modules/orders/pages/NewOrder.jsx"),
    read("src/modules/orders/pages/OrderDetail.jsx"),
    read("src/modules/orders/pages/InvoiceDetail.jsx"),
  ]);
  for (const source of files) {
    assert.match(source, /useBackNavigation/);
    assert.match(source, /onClick=\{goBack\}/);
  }
});

test("integration screens delegate the single back control to the Workspace header", async () => {
  const [layout, dashboard, gateway, agents] = await Promise.all([
    read("src/components/WorkspaceScreenLayout.jsx"),
    read("src/modules/integrations/pages/MexalDashboard.jsx"),
    read("src/modules/integrations/pages/DocumentGatewaySettings.jsx"),
    read("src/modules/integrations/pages/MexalAgents.jsx"),
  ]);
  assert.match(layout, /className="workspace-screen-back"/);
  for (const source of [dashboard, gateway, agents]) {
    assert.doesNotMatch(source, /className="integrations-back-button"/);
  }
});

test("local back controls keep restoring their previous in-page view", async () => {
  const products = await read("src/modules/pharmacy/pages/Prodotti.jsx");
  const days = await read("src/modules/pharmacy/pages/Giornate.jsx");
  assert.match(products, /setMostraFormCategoria\(false\)/);
  assert.match(products, /setMostraFormSottocategoria\(false\)/);
  assert.match(days, /function tornaAlPlanning\(\)/);
});

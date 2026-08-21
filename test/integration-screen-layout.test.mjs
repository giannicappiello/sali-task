import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("all synchronization routes keep their dedicated Workspace screens", async () => {
  const routes = await read("src/modules/integrations/IntegrationsModule.jsx");
  for (const path of [
    "mexal",
    "mexal/agenti",
    "mexal/serie-documenti",
    "orders/prof",
    "orders/ph",
    "documentale",
    "progremes",
  ]) {
    assert.match(routes, new RegExp(`path="${path.replace("/", "\\/")}"`));
  }
});

test("synchronization screens use one header and safe responsive control areas", async () => {
  const [styles, series, agents, documentGateway, orders] = await Promise.all([
    read("src/modules/integrations/integrations.css"),
    read("src/modules/integrations/pages/DocumentSeriesSettings.jsx"),
    read("src/modules/integrations/pages/MexalAgents.jsx"),
    read("src/modules/integrations/pages/DocumentGatewaySettings.jsx"),
    read("src/modules/integrations/components/OrderModuleSettings.jsx"),
  ]);

  assert.match(styles, /\.workspace-screen-content>\.mexal-page/);
  assert.match(styles, /\.mexal-history-table-wrap[\s\S]*overflow-x:auto/);
  assert.match(styles, /\.document-list-controls/);
  assert.match(styles, /\.integration-single-panel/);
  assert.doesNotMatch(series, /integrations-hero/);
  assert.match(agents, /mexal-history-table-wrap/);
  assert.match(documentGateway, /document-list-controls/);
  assert.match(documentGateway, /Avvia manualmente/);
  assert.match(documentGateway, /Arresta sincronizzazione/);
  assert.match(orders, /integration-single-panel/);
});

test("document-series actions remain available after layout normalization", async () => {
  const component = await read("src/components/OrdersDocumentSeriesSettings.jsx");
  for (const label of ["Sincronizza da Mexal", "Apri diagnostica", "Salva serie", "Copia JSON"]) {
    assert.match(component, new RegExp(label));
  }
});
